"""Loopback-only, trusted-workstation migration preview. NOT an Internet host.

No production login is provided. The server selects tenant 0; requests cannot
choose tenant/actor/role. Production cutover requires authenticated identity.
"""
import argparse
from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
import json
import mimetypes
from pathlib import Path
import re
import sqlite3
import socket
from urllib.parse import urlsplit
from service import execute
from recipe_command import save_recipe
from stock_command import apply_stock_changes
from chat_service import ChatService
from ai_charter import load_charter,CHARTER_SHA256
from store import Store,Principal,Conflict,Forbidden

HERE=Path(__file__).resolve().parent
APP=HERE.parent.parent

class Server(ThreadingHTTPServer):
    daemon_threads=True
    allow_reuse_address=False
    def server_bind(self):
        if hasattr(socket,'SO_EXCLUSIVEADDRUSE'):
            self.socket.setsockopt(socket.SOL_SOCKET,socket.SO_EXCLUSIVEADDRUSE,1)
        super().server_bind()
    def __init__(self,port,store):
        super().__init__(('127.0.0.1',port),Handler)
        self.store=store
        self.principal=Principal('0','local-preview','operator')
        self.chat=ChatService(store)

class Handler(BaseHTTPRequestHandler):
    def log_message(self,*args): pass
    def send(self,status,body,kind='application/json'):
        raw=json.dumps(body).encode() if kind=='application/json' else body
        self.send_response(status)
        self.send_header('Content-Type',kind)
        self.send_header('Content-Length',str(len(raw)))
        self.send_header('Cache-Control','no-store')
        self.send_header('X-Content-Type-Options','nosniff')
        self.send_header('Referrer-Policy','no-referrer')
        self.send_header('Content-Security-Policy',"default-src 'self'; script-src 'self' 'unsafe-inline'; "
                         "style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; "
                         "frame-ancestors 'none'; form-action 'self'; base-uri 'self'")
        self.end_headers(); self.wfile.write(raw)
    def permitted(self,write=False):
        port=self.server.server_port
        hosts={f'127.0.0.1:{port}',f'localhost:{port}'}
        if self.headers.get('Host') not in hosts: return False
        if self.headers.get('Sec-Fetch-Site')=='cross-site': return False
        if write and self.headers.get('Origin') not in {f'http://{host}' for host in hosts}: return False
        return True
    def do_GET(self):
        if not self.permitted(): return self.send(403,{'error':'Preview is local-origin only'})
        path=urlsplit(self.path).path
        if path=='/health': return self.send(200,{'status':'preview','tenant':'0','live_cutover':False})
        if path=='/api/v1/ai-charter':
            try: return self.send(200,{'text':load_charter(),'sha256':CHARTER_SHA256})
            except ValueError as exc: return self.send(503,{'error':str(exc)})
        if path in {'/','/index.html'}:
            source=(APP/'index.html').read_text(encoding='utf-8')
            source=re.sub(r'<link[^>]+(?:fonts.googleapis.com|fonts.gstatic.com)[^>]*>','',source)
            source=source.replace('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js','/local-client.js')
            source=source.replace('<body>','<body><div style="padding:12px;background:#fff3b0;text-align:center">'
                                  '<strong>LOCAL MIGRATION PREVIEW · Tenant 0 · Changes affect this copy only</strong></div>',1)
            source=source.replace('</body>','<link rel="stylesheet" href="/chat-widget.css">'
                                  '<script src="/preview-ui.js"></script><script src="/quantity.js"></script>'
                                  '<script src="/quantity-preview.js"></script><script src="/chat-widget.js"></script></body>')
            return self.send(200,source.encode(),'text/html; charset=utf-8')
        if path=='/config.js':
            return self.send(200,b"window.SUPABASE_URL='local-preview';window.SUPABASE_ANON_KEY='';",'text/javascript')
        if path=='/local-client.js': file=HERE/'local-client.js'
        elif path=='/preview-ui.js': file=HERE/'preview-ui.js'
        elif path in {'/quantity.js','/quantity-preview.js','/chat-widget.js','/chat-widget.css'}: file=HERE/path.lstrip('/')
        elif path=='/ui-cards.js': file=APP/'ui-cards.js'
        elif path.startswith('/docs/Images/'):
            file=(APP/path.lstrip('/')).resolve()
            if not file.is_relative_to((APP/'docs'/'Images').resolve()) or file.suffix.lower() not in {'.png','.jpg','.jpeg','.svg','.webp'}:
                return self.send(404,{'error':'Not found'})
        else: return self.send(404,{'error':'Not found'})
        if not file.is_file(): return self.send(404,{'error':'Not found'})
        return self.send(200,file.read_bytes(),mimetypes.guess_type(file.name)[0] or 'application/octet-stream')
    def do_POST(self):
        if not self.permitted(True): return self.send(403,{'error':'Preview is local-origin only'})
        if self.path not in {'/api/v1/query','/api/v1/commands/save-recipe','/api/v1/commands/stock','/api/v1/chat','/api/v1/chat/apply'}: return self.send(404,{'error':'Not found'})
        try:
            if self.headers.get('Content-Type','').split(';')[0]!='application/json': raise ValueError('JSON required')
            size=int(self.headers.get('Content-Length','0'))
            if not 0<size<=1_000_000: raise ValueError('Invalid request size')
            request=json.loads(self.rfile.read(size))
            if not isinstance(request,dict): raise ValueError('Object required')
            if self.path=='/api/v1/chat': return self.send(200,self.server.chat.chat(self.server.principal,request))
            if self.path=='/api/v1/chat/apply': return self.send(200,self.server.chat.apply(self.server.principal,request))
            if self.path=='/api/v1/commands/stock': return self.send(200,apply_stock_changes(self.server.store,self.server.principal,request))
            if self.path=='/api/v1/commands/save-recipe':
                return self.send(200,{'data':save_recipe(self.server.store,self.server.principal,request)})
            return self.send(200,{'data':execute(self.server.store,self.server.principal,request)})
        except Forbidden as exc: return self.send(403,{'error':str(exc)})
        except Conflict as exc: return self.send(409,{'error':str(exc)})
        except sqlite3.IntegrityError: return self.send(409,{'error':'Record conflicts with an existing ID or relationship; nothing committed'})
        except (ValueError,KeyError,TypeError) as exc: return self.send(400,{'error':'Invalid request: '+str(exc)})
        except Exception: return self.send(500,{'error':'Local operation failed; no success assumed'})

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--database',required=True); parser.add_argument('--port',type=int,default=18089)
    args=parser.parse_args()
    if not Path(args.database).is_file(): parser.error('Import an isolated staging database first')
    server=Server(args.port,Store(args.database))
    print(f'PREVIEW=http://127.0.0.1:{server.server_port}/',flush=True)
    server.serve_forever()
