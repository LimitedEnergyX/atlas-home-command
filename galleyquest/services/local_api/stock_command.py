"""Typed, tenant-scoped quantity commands. No model authority or unit inference."""
from contextlib import closing
from decimal import Decimal, InvalidOperation, localcontext
import hashlib
import json
import re
import uuid

from quantity import parse_quantity
from store import Conflict, encode, now


def _validate(request):
    if not isinstance(request, dict) or set(request) != {'request_id', 'operations'}:
        raise ValueError('Invalid stock command fields')
    if not isinstance(request['request_id'], str):
        raise ValueError('Request UUID required')
    uuid.UUID(request['request_id'])
    operations = request['operations']
    if not isinstance(operations, list) or not 1 <= len(operations) <= 10:
        raise ValueError('Provide between one and ten stock changes')
    seen, parsed = set(), []
    for operation in operations:
        if not isinstance(operation, dict) or set(operation) != {
                'stock_id', 'action', 'quantity_text', 'expected_revision'}:
            raise ValueError('Invalid stock operation fields')
        stock_id = operation['stock_id']
        if not isinstance(stock_id, str) or not stock_id or len(stock_id) > 200:
            raise ValueError('Stock ID required')
        if stock_id in seen:
            raise ValueError('A stock item can appear only once per command')
        seen.add(stock_id)
        if not isinstance(operation['action'], str) or operation['action'] not in {'set', 'add', 'consume', 'waste'}:
            raise ValueError('Unsupported stock action')
        if type(operation['expected_revision']) is not int or operation['expected_revision'] < 1:
            raise ValueError('A positive integer stock revision is required')
        if not isinstance(operation['quantity_text'], str):
            raise ValueError('Quantity text required')
        quantity = parse_quantity(operation['quantity_text'])
        if not quantity or not quantity['unit']:
            raise ValueError('Provide an explicit supported quantity unit')
        parsed.append((operation, quantity))
    return parsed


def _decimal_text(amount):
    text = format(amount, 'f')
    if '.' in text:
        text = text.rstrip('0').rstrip('.')
    return text or '0'


def _known_quantity(row):
    amount, unit = row.get('quantity_amount'), row.get('quantity_unit')
    if amount is None or not unit:
        return None
    try:
        parsed = parse_quantity(f'{amount} {unit}')
    except (ValueError, InvalidOperation):
        return None
    return parsed if parsed and parsed['unit'] else None


def _sync_qty_notes(notes, amount, unit):
    """Keep one canonical legacy Qty line without changing other note text."""
    text = notes or ''
    canonical = f'Qty: {amount} {unit}'
    output, replaced = [], False
    for line in text.splitlines(keepends=True):
        if re.match(r'^[ \t]*Qty[ \t]*:', line, re.I):
            if not replaced:
                ending = '\r\n' if line.endswith('\r\n') else '\n' if line.endswith('\n') else '\r' if line.endswith('\r') else ''
                output.append(canonical + ending)
                replaced = True
        else:
            output.append(line)
    if replaced:
        return ''.join(output)
    newline = '\r\n' if '\r\n' in text else '\n'
    return canonical + (newline + text if text else '')


def _plan(store, db, principal, operations):
    planned = []
    for operation, quantity in operations:
        rows = store._read(db, principal, 'stock_items', [('id', 'eq', operation['stock_id'])])
        if not rows:
            raise Conflict('Stock item no longer exists in this household')
        before = rows[0]
        if before['_revision'] != operation['expected_revision']:
            raise Conflict('Stock changed; reload before applying')
        known = _known_quantity(before)
        amount = Decimal(quantity['amount'])
        if operation['action'] != 'set':
            if known is None:
                raise ValueError('Set a known remaining quantity before adding or subtracting')
            if known['unit'] != quantity['unit']:
                raise ValueError('Quantity units must match; conversions are not inferred')
            with localcontext() as context:
                context.prec = 160
                amount = Decimal(known['amount']) + (amount if operation['action'] == 'add' else -amount)
            if amount < 0:
                raise ValueError('This change would make remaining stock negative')
        after = {'quantity_amount': _decimal_text(amount), 'quantity_unit': quantity['unit'],
                 'status': 'OUT' if amount == 0 else 'LOW' if before.get('status') == 'LOW' else 'OK'}
        planned.append((operation, before, after, known))
    return planned


def preview_stock_changes(store, principal, request):
    """Read-only proposal, using a consistent read snapshot and no audit writes."""
    store.authorize(principal, 'stock_items')
    operations = _validate(request)
    with closing(store.connection()) as db:
        db.execute('BEGIN')
        planned = _plan(store, db, principal, operations)
        return [{'name': before['name'], 'action': operation['action'],
                 'before': f"{known['amount']} {known['unit']}" if known else 'Unknown',
                 'after': f"{after['quantity_amount']} {after['quantity_unit']}"}
                for operation, before, after, known in planned]


def apply_stock_changes(store, principal, request):
    """Validate, apply, audit, and record the retry receipt in one transaction."""
    store.authorize(principal, 'stock_items', True)
    operations = _validate(request)
    fingerprint = hashlib.sha256(encode(request).encode()).hexdigest()
    with store.transaction() as db:
        prior = db.execute("SELECT after_json FROM audit_events WHERE tenant_id=? AND actor_id=? "
                           "AND operation='stock-quantity-command' AND row_id=? ORDER BY sequence LIMIT 1",
                           (principal.tenant_id, principal.actor_id, request['request_id'])).fetchone()
        if prior:
            receipt = json.loads(prior[0])
            if receipt['fingerprint'] != fingerprint:
                raise Conflict('Request ID reused for a different stock change')
            return receipt['result']
        planned = _plan(store, db, principal, operations)
        items = []
        for operation, before, values, _known in planned:
            notes = _sync_qty_notes(before.get('notes'), values['quantity_amount'], values['quantity_unit'])
            db.execute('UPDATE stock_items SET quantity_amount=?,quantity_unit=?,status=?,notes=?,updated_at=?,'
                       'revision=revision+1 WHERE tenant_id=? AND id=?',
                       (values['quantity_amount'], values['quantity_unit'], values['status'], notes, now(),
                        principal.tenant_id, before['id']))
            after = store._read(db, principal, 'stock_items', [('id', 'eq', before['id'])])[0]
            store.audit(db, principal, 'stock-' + operation['action'], 'stock_items', before['id'], before, after)
            items.append(after)
        result = {'applied': True, 'items': items}
        store.audit(db, principal, 'stock-quantity-command', 'stock_items', request['request_id'], None,
                    {'fingerprint': fingerprint, 'result': result})
        return result
