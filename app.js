'use strict';

const priorityRank = { Urgent: 0, Routine: 1, Scheduled: 2 };
const byId = (id) => document.getElementById(id);
let workflow = new Workflow();

function isOutstanding(request) {
  return request.status !== 'Closed' && request.status !== 'Complete';
}

function runAction(action) {
  const message = byId('message');
  try {
    action();
    message.textContent = workflow.pending
      ? 'Delivery saved. The queue summary is stale. Reconcile or retry the same serial.'
      : 'Action recorded.';
  } catch (error) {
    message.textContent = error.message;
    workflow.log('System', error.message);
  }
  render();
}

function actionButton(label, action) {
  const button = document.createElement('button');
  button.textContent = label;
  button.onclick = () => runAction(action);
  return button;
}

function appendCell(row, text) {
  const cell = document.createElement('td');
  cell.textContent = text;
  row.append(cell);
  return cell;
}

function renderMetrics() {
  const openRequests = workflow.requests.filter(isOutstanding).length;
  const activeDeliveries = workflow.deliveries.filter((delivery) => !delivery.voided).length;
  const summary = workflow.pending ? 'Stale' : 'Current';
  const connection = workflow.connected ? 'Available' : 'Unavailable';

  byId('metrics').innerHTML = `
    <div class="metric"><strong>${openRequests}</strong>Open requests</div>
    <div class="metric"><strong>${activeDeliveries}</strong>Active deliveries</div>
    <div class="metric"><strong>${summary}</strong>Queue summary</div>
    <div class="metric"><strong>${connection}</strong>Simulated connection</div>
  `;
  byId('connection').textContent = workflow.connected
    ? 'Simulate connection failure'
    : 'Restore simulated connection';
}

function renderRequestQueue() {
  const queue = byId('queue');
  queue.replaceChildren();

  const requests = [...workflow.requests].sort(
    (first, second) =>
      priorityRank[first.priority] - priorityRank[second.priority] ||
      first.id.localeCompare(second.id),
  );

  for (const request of requests) {
    const row = document.createElement('tr');
    appendCell(row, `${request.id} / ${request.destination}`);
    appendCell(row, request.priority);
    appendCell(row, `${request.qty} / ${request.delivered} / ${request.shortage}`);
    const status = workflow.pending ? `${request.status} (summary unverified)` : request.status;
    const statusCell = appendCell(row, status);
    if (request.shortage && request.acknowledgedAt) {
      statusCell.className = 'status alert';
    }

    const actions = appendCell(row, '');
    if (request.status === 'Requested') {
      actions.append(actionButton('Acknowledge', () => workflow.acknowledge(request.id)));
    }
    if (isOutstanding(request)) {
      actions.append(
        actionButton('Close outstanding', () => workflow.close(request.id, byId('reason').value)),
      );
    }
    if (request.acknowledgedAt) {
      const time = document.createElement('small');
      time.textContent = 'Acknowledged ' + new Date(request.acknowledgedAt).toLocaleTimeString();
      actions.append(time);
    }

    queue.append(row);
  }
}

function renderRequestPicker() {
  const picker = byId('request');
  const selected = picker.value;
  picker.replaceChildren();

  for (const request of workflow.requests) {
    const option = document.createElement('option');
    option.value = request.id;
    option.textContent = `${request.id} / ${request.destination}`;
    picker.append(option);
  }
  if (workflow.requests.some((request) => request.id === selected)) {
    picker.value = selected;
  }
}

function renderDeliveryEvidence() {
  const evidence = byId('deliveries');
  evidence.replaceChildren();

  for (const delivery of workflow.deliveries) {
    const row = document.createElement('tr');
    appendCell(row, `${delivery.id} / ${delivery.request}`);
    appendCell(row, delivery.serial);
    appendCell(row, String(delivery.qty));
    appendCell(row, delivery.voided ? 'Voided' : 'Active');

    const label = delivery.voided ? 'Restore' : 'Void';
    const action = delivery.voided ? 'restore' : 'void';
    appendCell(row, '').append(
      actionButton(label, () => workflow.correct(delivery.id, action, byId('reason').value)),
    );
    evidence.append(row);
  }
}

function renderActivity() {
  const history = byId('events');
  history.replaceChildren();

  for (const event of workflow.events) {
    const item = document.createElement('li');
    item.textContent = `${event.time} · ${event.id}: ${event.message}`;
    history.append(item);
  }
}

function render() {
  renderMetrics();
  renderRequestQueue();
  renderRequestPicker();
  renderDeliveryEvidence();
  renderActivity();
}

byId('reset').onclick = () => {
  workflow = new Workflow();
  byId('message').textContent = 'Demonstration reset.';
  render();
};

byId('connection').onclick = () => runAction(() => {
  workflow.connected = !workflow.connected;
  const message = workflow.connected
    ? 'Simulated connection restored.'
    : 'Simulated connection unavailable.';
  workflow.log('System', message);
});

byId('reconcile').onclick = () => runAction(() => workflow.reconcile());

byId('delivery').onsubmit = (event) => {
  event.preventDefault();
  const failure = byId('failure').value;
  runAction(() => workflow.deliver(
    byId('request').value,
    byId('serial').value,
    Number(byId('quantity').value),
    { failSummary: failure === 'summary', timeout: failure === 'timeout' },
  ));
};

byId('form').onsubmit = (event) => {
  event.preventDefault();
  runAction(() => workflow.submit({
    qty: Number(byId('qty').value),
    destination: byId('destination').value,
    priority: byId('priority').value,
  }));
};

byId('duplicate').onclick = () => runAction(() => {
  const input = { qty: 10, destination: 'Cell C', priority: 'Routine' };
  workflow.submit(input, 'repeat-demo');
  workflow.submit(input, 'repeat-demo');
});

render();
