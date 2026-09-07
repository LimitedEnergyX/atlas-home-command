import json
import tempfile
import threading
import unittest
from pathlib import Path
from unittest.mock import patch
from urllib.request import Request, urlopen
from urllib.error import HTTPError
from atlas_orchestrator.api import AtlasHTTPServer, STATIC_ROUTES
from atlas_orchestrator.config import Settings
from atlas_orchestrator.core import AtlasOrchestrator


class ReleaseBoundaryTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory()
        with patch.dict("os.environ", {"ATLAS_HOME_ASSISTANT_TOKEN":"", "ATLAS_IDS_MONITOR_ENABLED":"0"}):
            self.core=AtlasOrchestrator(Settings(Path(self.temp.name)))
        self.server=AtlasHTTPServer(("127.0.0.1",0),self.core)
        self.thread=threading.Thread(target=self.server.serve_forever,daemon=True)
        self.thread.start()
        self.base=f"http://127.0.0.1:{self.server.server_port}"

    def tearDown(self):
        self.server.shutdown();self.server.server_close();self.thread.join();self.temp.cleanup()

    def request(self,path,body=None,headers=None):
        encoded = None if body is None else b"" if body == {} else json.dumps(body).encode()
        request=Request(self.base+path,data=encoded,headers={"Content-Type":"application/json",**(headers or {})})
        try:
            with urlopen(request,timeout=5) as response:return response.status,response.read()
        except HTTPError as error:return error.code,error.read()

    def test_packaged_assets_exist_and_are_served(self):
        for route,path in STATIC_ROUTES.items():
            with self.subTest(route=route):
                self.assertTrue(path.is_file());self.assertEqual(self.request(route)[0],200)

    def test_maintenance_roundtrip_rejections_and_origin_guard(self):
        task={"equipment":"Example equipment","task":"Inspection","due_date":"2030-06-10"}
        # This guard rejects headers before reading JSON. Avoid an unread-body
        # connection-close race on Windows; payload validation is tested below.
        self.assertEqual(self.request("/v1/maintenance",{},{"Origin":"https://example.com"})[0],403)
        self.assertEqual(self.request("/v1/maintenance",{**task,"due_date":"invalid"})[0],400)
        status,body=self.request("/v1/maintenance",task);self.assertEqual(status,200)
        identifier=json.loads(body)["id"]
        for _ in range(2):self.assertEqual(self.request("/v1/maintenance/complete",{"id":identifier})[0],200)
        self.assertEqual(json.loads(self.request("/v1/maintenance")[1])["summary"]["completed"],1)

    def test_trusted_non_loopback_cannot_write_without_opt_in(self):
        with patch.object(self.server,"client_is_trusted",return_value=True),patch.object(self.server,"client_is_loopback",return_value=False):
            for route in ["/v1/maintenance","/v1/maintenance/complete","/v1/home/hvac","/v1/home/controls","/v1/security/vacation-ids","/v1/chat"]:
                with self.subTest(route=route):self.assertEqual(self.request(route,{})[0],403)

    def test_configuration_directory_is_never_served(self):
        self.assertEqual(self.request("/galleyquest/atlas-status.json")[0],404)
        self.assertEqual(self.request("/galleyquest/config.js")[0],404)

    def test_inherited_token_does_not_enable_presence_monitor(self):
        with patch.dict("os.environ",{"ATLAS_HOME_ASSISTANT_TOKEN":"test-only","ATLAS_IDS_MONITOR_ENABLED":"0"}),patch("atlas_orchestrator.core.VacationIDSTarget") as monitor:
            AtlasOrchestrator(Settings(Path(self.temp.name)/"isolated"))
            self.assertFalse(monitor.call_args.kwargs["start_monitor"])
