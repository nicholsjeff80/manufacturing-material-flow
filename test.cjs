const assert = require('node:assert/strict');
const { test } = require('node:test');
const Workflow = require('./engine.js');

const requestId = 'REQ-101';

function startRequest() {
  const workflow = new Workflow();
  workflow.acknowledge(requestId);
  return workflow;
}

test('partial delivery stays open and completion preserves acknowledgment', () => {
  const workflow = startRequest();
  const request = workflow.request(requestId);
  const acknowledgment = request.acknowledgedAt;

  workflow.deliver(requestId, 'DEMO-A', 40);
  assert.equal(request.shortage, 20);
  assert.equal(request.status, 'Acknowledged');

  workflow.deliver(requestId, 'DEMO-B', 20);
  assert.equal(request.status, 'Complete');
  assert.equal(request.acknowledgedAt, acknowledgment);
});

test('a repeat scan retains the original quantity and rejects cross-request reuse', () => {
  const workflow = startRequest();

  workflow.deliver(requestId, 'DEMO-A', 40);
  workflow.deliver(requestId, ' demo-a ', 99);
  assert.equal(workflow.request(requestId).delivered, 40);
  assert.equal(workflow.deliveries.length, 1);

  workflow.acknowledge('REQ-102');
  assert.throws(() => workflow.deliver('REQ-102', 'DEMO-A', 1));
});

test('voiding requires a reason and reopens the shortage until explicitly restored', () => {
  const workflow = startRequest();
  const request = workflow.request(requestId);
  const acknowledgment = request.acknowledgedAt;
  const delivery = workflow.deliver(requestId, 'DEMO-A', 60);

  assert.throws(() => workflow.correct(delivery.id, 'void', ''));
  workflow.correct(delivery.id, 'void', 'Synthetic review');
  assert.equal(request.shortage, 60);
  assert.equal(request.acknowledgedAt, acknowledgment);
  assert.throws(() => workflow.deliver(requestId, 'DEMO-A', 60));

  workflow.correct(delivery.id, 'restore', 'Synthetic review');
  assert.equal(request.status, 'Complete');
  assert.equal(workflow.deliveries.length, 1);
});

for (const [failure, description] of [
  ['failSummary', 'a failed summary update'],
  ['timeout', 'a lost response'],
]) {
  test(`${description} preserves delivery evidence and a retry counts once`, () => {
    const workflow = startRequest();
    const request = workflow.request(requestId);

    workflow.deliver(requestId, 'DEMO-A', 40, { [failure]: true });
    assert.equal(workflow.pending, true);
    assert.equal(request.delivered, 0);
    assert.equal(workflow.deliveries.length, 1);
    assert.throws(() => workflow.close(requestId, 'Synthetic review'));

    workflow.deliver(requestId, 'DEMO-A', 99);
    assert.equal(workflow.pending, false);
    assert.equal(request.delivered, 40);
    assert.equal(workflow.deliveries.length, 1);
  });
}

test('closure retains deliveries through correction and reconciliation', () => {
  const workflow = startRequest();
  const delivery = workflow.deliver(requestId, 'DEMO-A', 40);

  workflow.close(requestId, 'No further material needed');
  workflow.correct(delivery.id, 'void', 'Synthetic review');

  assert.equal(workflow.request(requestId).status, 'Closed');
  assert.equal(workflow.deliveries.length, 1);
  assert.throws(() => workflow.deliver(requestId, 'DEMO-B', 20));
});

test('a disconnected delivery records nothing and can be retried', () => {
  const workflow = startRequest();
  workflow.connected = false;

  assert.throws(() => workflow.deliver(requestId, 'DEMO-A', 40));
  assert.equal(workflow.deliveries.length, 0);
  assert.throws(() => workflow.reconcile());

  workflow.connected = true;
  workflow.deliver(requestId, 'DEMO-A', 40);
  assert.equal(workflow.request(requestId).shortage, 20);
});

test('delivery validates input and keeps the actual quantity on overdelivery', () => {
  const workflow = new Workflow();
  assert.throws(() => workflow.deliver(requestId, 'DEMO-A', 40));

  workflow.acknowledge(requestId);
  assert.throws(() => workflow.deliver(requestId, 'REAL123', 40));
  assert.throws(() => workflow.deliver(requestId, 'DEMO-A', -1));

  workflow.deliver(requestId, 'DEMO-A', 65);
  const request = workflow.request(requestId);
  assert.equal(request.delivered, 65);
  assert.equal(request.shortage, 0);
});

test('repeating a request submission with the same key creates one request', () => {
  const workflow = new Workflow();
  const input = { qty: 5, destination: 'Cell A', priority: 'Routine' };

  workflow.submit(input, 'repeat-demo');
  workflow.submit(input, 'repeat-demo');

  assert.equal(workflow.requests.length, 4);
  assert.throws(() => workflow.submit({ ...input, qty: 1.5 }));
});

test('a failed offline closure leaves the request open after reconnecting', () => {
  const workflow = startRequest();
  const request = workflow.request(requestId);
  workflow.deliver(requestId, 'DEMO-A', 40);
  workflow.connected = false;
  const eventCount = workflow.events.length;

  assert.throws(
    () => workflow.close(requestId, 'Synthetic closure'),
    /Restore the simulated connection/,
  );
  assert.equal(request.closed, false);
  assert.equal(workflow.events.length, eventCount);

  workflow.connected = true;
  workflow.reconcile();
  assert.equal(request.status, 'Acknowledged');
  assert.equal(request.shortage, 20);

  workflow.close(requestId, 'Synthetic closure');
  assert.equal(request.status, 'Closed');
});

test('an unsafe restore leaves delivery evidence and the stale summary intact', () => {
  const workflow = startRequest();
  const request = workflow.request(requestId);
  const original = workflow.deliver(requestId, 'DEMO-A', Number.MAX_SAFE_INTEGER);
  workflow.correct(original.id, 'void', 'Synthetic boundary check');

  const recent = workflow.deliver(requestId, 'DEMO-B', 60, { failSummary: true });
  assert.equal(request.delivered, 0);
  const eventCount = workflow.events.length;

  assert.throws(
    () => workflow.correct(original.id, 'restore', 'Synthetic boundary check'),
    /Quantity exceeds the supported range/,
  );
  assert.equal(original.voided, true);
  assert.equal(workflow.pending, true);
  assert.equal(request.delivered, 0);
  assert.equal(workflow.events.length, eventCount);

  workflow.reconcile();
  assert.equal(request.delivered, 60);

  workflow.correct(recent.id, 'void', 'Synthetic boundary check');
  workflow.correct(original.id, 'restore', 'Synthetic boundary check');
  assert.equal(request.delivered, Number.MAX_SAFE_INTEGER);
});
