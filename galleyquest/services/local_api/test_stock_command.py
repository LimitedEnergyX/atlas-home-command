from contextlib import closing
import copy
from pathlib import Path
import sqlite3
import tempfile
import unittest
import uuid

from store import Conflict, Forbidden, Principal, Store
from stock_command import apply_stock_changes, preview_stock_changes


class StockCommandTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.store = Store(Path(self.tmp.name) / 'test.sqlite3')
        self.store.initialize()
        self.store.create_tenant('0', 'Household')
        self.store.create_tenant('1', 'Other')
        self.principal = Principal('0', 'tester', 'owner')
        self.other = Principal('1', 'other', 'owner')

    def add(self, name='Milk', amount=None, unit=None, status='OK', principal=None, **extra):
        # Direct bootstrap is limited to this disposable test database. Public
        # mutations deliberately cannot bypass the quantity command boundary.
        with self.store.transaction() as db:
            return self.store._insert(db, principal or self.principal, 'stock_items',
                {'name': name, 'quantity_amount': amount, 'quantity_unit': unit, 'status': status,
                 'notes': 'Keep refrigerated; preferred brand', **extra})

    def command(self, row, action='set', quantity='1/2 gallon'):
        return {'request_id': str(uuid.uuid4()), 'operations': [{'stock_id': row['id'], 'action': action,
                 'quantity_text': quantity, 'expected_revision': row['_revision']}]}

    def snapshot(self):
        with closing(self.store.connection()) as db:
            return {table: [tuple(row) for row in db.execute('SELECT * FROM ' + table)] for table in
                    ('stock_items', 'recipes', 'recipe_ingredients', 'meal_plan', 'grocery_extra_items',
                     'grocery_dismissed_items', 'audit_events')}

    def test_fraction_set_preview_read_only_and_preserves_fields(self):
        milk = self.add(expiration_date='2026-10-01', refresh_watch=True)
        command = self.command(milk)
        baseline = self.snapshot()
        self.assertEqual(preview_stock_changes(self.store, self.principal, command),
                         [{'name': 'Milk', 'action': 'set', 'before': 'Unknown', 'after': '0.5 gallon'}])
        self.assertEqual(self.snapshot(), baseline)
        item = apply_stock_changes(self.store, self.principal, command)['items'][0]
        self.assertEqual((item['quantity_amount'], item['quantity_unit']), ('0.5', 'gallon'))
        self.assertEqual(item['notes'], 'Qty: 0.5 gallon\n' + milk['notes'])
        for field in ('id', 'created_at', 'expiration_date', 'refresh_watch'):
            self.assertEqual(item[field], milk[field])
        self.assertEqual(item['_revision'], milk['_revision'] + 1)
        for table in baseline:
            if table not in {'stock_items', 'audit_events'}:
                self.assertEqual(self.snapshot()[table], baseline[table])

    def test_add_consume_waste_and_zero_status(self):
        row = self.add(amount='0.5', unit='gallon', status='LOW')
        for action, quantity, expected, status in [('add', '1/4 gallons', '0.75', 'LOW'),
                ('consume', '.25 gal', '0.5', 'LOW'), ('waste', '1/2 gallon', '0', 'OUT'),
                ('set', '10 eggs', '10', 'OK')]:
            row = apply_stock_changes(self.store, self.principal, self.command(row, action, quantity))['items'][0]
            self.assertEqual((row['quantity_amount'], row['status']), (expected, status))
            self.assertEqual(row['notes'].splitlines()[0], f"Qty: {expected} {row['quantity_unit']}")
            self.assertEqual(row['notes'].splitlines()[1:], ['Keep refrigerated; preferred brand'])

    def test_qty_note_replaced_once_preserving_other_text(self):
        for original, expected in [
                ('Brand note\r\n  qTy : 9 gallons\r\nKeep cold  \r\n',
                 'Brand note\r\nQty: 0.5 gallon\r\nKeep cold  \r\n'),
                ('Qty: 9 gallons\nEvidence\nQty: 7 gallons\nLast note',
                 'Qty: 0.5 gallon\nEvidence\nLast note'),
                ('Qty: 4 gallons', 'Qty: 0.5 gallon'),
                ('First\r\nSecond', 'Qty: 0.5 gallon\r\nFirst\r\nSecond'),
                (None, 'Qty: 0.5 gallon'),
                ('', 'Qty: 0.5 gallon')]:
            row = self.add(notes=original)
            result = apply_stock_changes(self.store, self.principal, self.command(row))['items'][0]
            self.assertEqual(result['notes'], expected)

    def test_delta_rejects_unknown_or_mismatched_units(self):
        for row, text in [(self.add(), '1 gallon'), (self.add(amount='1', unit='gallon'), '1 cup')]:
            before = self.snapshot()
            with self.assertRaises(ValueError):
                apply_stock_changes(self.store, self.principal, self.command(row, 'consume', text))
            self.assertEqual(self.snapshot(), before)

    def test_stale_or_negative_batch_is_atomic(self):
        first = self.add(amount='1', unit='gallon')
        second = self.add('Eggs', '2', 'egg')
        for stale in (True, False):
            command = self.command(first)
            operation = self.command(second, 'consume', '3 eggs')['operations'][0]
            if stale:
                operation['expected_revision'] += 1
            command['operations'].append(operation)
            before = self.snapshot()
            with self.assertRaises(Conflict if stale else ValueError):
                apply_stock_changes(self.store, self.principal, command)
            self.assertEqual(self.snapshot(), before)

    def test_late_database_failure_rolls_back_all_updates_and_audits(self):
        first, second = self.add(), self.add('Eggs')
        command = self.command(first)
        command['operations'].append(self.command(second, 'set', '2 eggs')['operations'][0])
        with self.store.transaction() as db:
            db.execute("CREATE TRIGGER reject_second BEFORE UPDATE ON stock_items WHEN OLD.name='Eggs' "
                       "BEGIN SELECT RAISE(ABORT,'test failure'); END")
        before = self.snapshot()
        with self.assertRaises(sqlite3.IntegrityError):
            apply_stock_changes(self.store, self.principal, command)
        self.assertEqual(self.snapshot(), before)

    def test_idempotent_retry_after_store_reopen_and_payload_conflict(self):
        command = self.command(self.add())
        first = apply_stock_changes(self.store, self.principal, command)
        baseline = self.snapshot()
        self.assertEqual(apply_stock_changes(Store(self.store.path), self.principal, command), first)
        self.assertEqual(self.snapshot(), baseline)
        changed = copy.deepcopy(command)
        changed['operations'][0]['quantity_text'] = '1 gallon'
        with self.assertRaises(Conflict): apply_stock_changes(self.store, self.principal, changed)
        self.assertEqual(self.snapshot(), baseline)

    def test_cross_tenant_id_not_accessible(self):
        row = self.add(principal=self.other)
        command = self.command(row)
        baseline = self.snapshot()
        for function in (preview_stock_changes, apply_stock_changes):
            with self.assertRaises(Conflict): function(self.store, self.principal, command)
        self.assertEqual(self.snapshot(), baseline)

    def test_receipts_are_tenant_scoped(self):
        first = self.add(id='shared')
        self.add(id='shared', principal=self.other)
        command = self.command(first)
        apply_stock_changes(self.store, self.principal, command)
        result = apply_stock_changes(self.store, self.other, command)
        self.assertEqual(result['items'][0]['_revision'], 2)

    def test_write_roles_and_spoofing_rejected(self):
        command = self.command(self.add())
        for role in ('viewer', 'planner'):
            with self.assertRaises(Forbidden):
                apply_stock_changes(self.store, Principal('0', 'reader', role), command)
        self.assertEqual(len(preview_stock_changes(self.store, Principal('0', 'reader', 'viewer'), command)), 1)
        command['tenant_id'] = '1'
        with self.assertRaises(ValueError): apply_stock_changes(self.store, self.principal, command)

    def test_malformed_units_and_duplicate_targets_rejected(self):
        row = self.add()
        for text in ('', '1', '-1 gallon', '1/0 gallon', 'NaN gallons', 'half bottle', '1 bathtub'):
            with self.subTest(text=text), self.assertRaises(ValueError):
                apply_stock_changes(self.store, self.principal, self.command(row, quantity=text))
        command = self.command(row)
        command['operations'] *= 2
        with self.assertRaises(ValueError): apply_stock_changes(self.store, self.principal, command)

    def test_batch_boundaries_and_strict_contract(self):
        row = self.add()
        variants = []
        command = self.command(row)
        command['operations'] = []
        variants.append(command)
        command = self.command(row)
        command['operations'] *= 11
        variants.append(command)
        for field, value in [('action', []), ('expected_revision', True), ('expected_revision', 0),
                             ('quantity_text', 0.5)]:
            command = self.command(row)
            command['operations'][0][field] = value
            variants.append(command)
        command = self.command(row)
        command['operations'][0]['tenant_id'] = '1'
        variants.append(command)
        baseline = self.snapshot()
        for command in variants:
            with self.assertRaises(ValueError): apply_stock_changes(self.store, self.principal, command)
        self.assertEqual(self.snapshot(), baseline)

    def test_two_item_batch_changes_only_targeted_rows(self):
        first, second, untouched = self.add(), self.add('Eggs'), self.add('Rice')
        command = self.command(first)
        command['operations'].append(self.command(second, 'set', '12 eggs')['operations'][0])
        result = apply_stock_changes(self.store, self.principal, command)
        self.assertEqual(len(result['items']), 2)
        self.assertEqual(self.store.read(self.principal, 'stock_items', [('id', 'eq', untouched['id'])])[0], untouched)


if __name__ == '__main__':
    unittest.main()
