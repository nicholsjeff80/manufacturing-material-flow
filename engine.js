(function (root) {
  'use strict';

  class Workflow {
    constructor() {
      this.requests = [];
      this.deliveries = [];
      this.events = [];
      this.connected = true;
      this.pending = false;
      this.next = 101;
      this.sequence = 1;

      const sampleRequests = [
        { qty: 60, destination: 'Cell A', priority: 'Urgent' },
        { qty: 45, destination: 'Cell B', priority: 'Routine' },
        { qty: 20, destination: 'Cell C', priority: 'Scheduled' },
      ];
      for (const request of sampleRequests) {
        this.submit(request);
      }
    }

    log(id, message) {
      this.events.unshift({ time: new Date().toLocaleTimeString(), id, message });
    }

    request(id) {
      const request = this.requests.find((entry) => entry.id === id);
      if (!request) {
        throw new Error('Request not found.');
      }
      return request;
    }

    submit({ qty, destination, priority }, key) {
      if (key) {
        const existing = this.requests.find((request) => request.key === key);
        if (existing) {
          this.log(existing.id, 'Retry returned the existing request.');
          return existing;
        }
      }

      if (
        !Number.isSafeInteger(qty) ||
        qty < 1 ||
        !['Cell A', 'Cell B', 'Cell C'].includes(destination) ||
        !['Urgent', 'Routine', 'Scheduled'].includes(priority)
      ) {
        throw new Error('Use a positive whole quantity and a listed destination and priority.');
      }

      const request = {
        id: 'REQ-' + this.next++,
        qty,
        destination,
        priority,
        key,
        status: 'Requested',
        acknowledgedAt: null,
        delivered: 0,
        shortage: qty,
        closed: false,
      };
      this.requests.push(request);
      this.log(request.id, 'Synthetic request created.');
      return request;
    }

    acknowledge(id) {
      const request = this.request(id);
      if (request.status !== 'Requested') {
        throw new Error('This request has already been acknowledged.');
      }

      request.acknowledgedAt = new Date().toISOString();
      request.status = 'Acknowledged';
      this.log(id, 'Handler acknowledged request. Service clock started.');
    }

    activeDeliveryTotal(requestId) {
      return this.deliveries
        .filter((delivery) => delivery.request === requestId && !delivery.voided)
        .reduce((total, delivery) => total + delivery.qty, 0);
    }

    checkDeliveryRange(requestId, quantity) {
      // A failed summary update can leave the cached total behind the delivery records.
      if (!Number.isSafeInteger(this.activeDeliveryTotal(requestId) + quantity)) {
        throw new Error('Quantity exceeds the supported range.');
      }
    }

    deliver(id, serial, qty, { failSummary = false, timeout = false } = {}) {
      const request = this.request(id);
      const normalizedSerial = String(serial).trim().toUpperCase();
      if (!this.connected) {
        throw new Error('Simulated connection unavailable. No delivery recorded.');
      }
      if (!/^DEMO-[A-Z0-9-]{1,24}$/.test(normalizedSerial)) {
        throw new Error('Use a synthetic serial beginning DEMO-.');
      }

      const existing = this.deliveries.find((delivery) => delivery.serial === normalizedSerial);
      if (existing) {
        if (existing.request !== id) {
          throw new Error('Serial already belongs to another request.');
        }
        if (existing.voided) {
          throw new Error('Delivery is voided. Restore it explicitly.');
        }

        this.reconcile();
        this.log(id, 'Duplicate scan reconciled. Original quantity retained.');
        return existing;
      }

      if (request.closed || request.status !== 'Acknowledged') {
        throw new Error('Acknowledge an open request before recording a new delivery.');
      }
      if (!Number.isSafeInteger(qty) || qty < 1) {
        throw new Error('Delivery quantity must be a positive whole number.');
      }
      this.checkDeliveryRange(id, qty);

      const delivery = {
        id: 'DEL-' + this.sequence++,
        request: id,
        serial: normalizedSerial,
        qty,
        voided: false,
        time: new Date().toISOString(),
        operator: 'Demo handler',
      };
      this.deliveries.push(delivery);
      this.log(id, `Recorded ${qty} units on ${normalizedSerial}.`);

      if (failSummary || timeout) {
        this.pending = true;
        const message = timeout
          ? 'Simulated response lost after delivery saved. Retry the same serial to recover.'
          : 'Delivery saved. Summary refresh failed. Reconcile to recover.';
        this.log(id, message);
        return delivery;
      }

      this.reconcile();
      return delivery;
    }

    reconcile() {
      if (!this.connected) {
        throw new Error('Restore the simulated connection before reconciliation.');
      }

      for (const request of this.requests) {
        request.delivered = this.activeDeliveryTotal(request.id);
        request.shortage = Math.max(0, request.qty - request.delivered);
        if (request.closed) {
          request.status = 'Closed';
        } else if (request.delivered >= request.qty) {
          request.status = 'Complete';
        } else {
          request.status = request.acknowledgedAt ? 'Acknowledged' : 'Requested';
        }
      }

      this.pending = false;
      this.log('System', 'Request summaries refreshed from active delivery records.');
    }

    correct(id, action, reason) {
      if (!this.connected) {
        throw new Error('Restore the simulated connection first.');
      }
      const note = typeof reason === 'string' ? reason.trim() : '';
      if (!note) {
        throw new Error('A reason is required.');
      }
      const delivery = this.deliveries.find((entry) => entry.id === id);
      if (!delivery) {
        throw new Error('Delivery not found.');
      }
      if (action !== 'void' && action !== 'restore') {
        throw new Error('Unknown correction.');
      }

      const voiding = action === 'void';
      if (delivery.voided === voiding) {
        throw new Error('Delivery already has that state.');
      }
      if (!voiding) {
        this.checkDeliveryRange(delivery.request, delivery.qty);
      }

      delivery.voided = voiding;
      this.log(delivery.request, `${action} ${delivery.serial}: ${note} (Demo reviewer).`);
      this.reconcile();
    }

    close(id, reason) {
      const request = this.request(id);
      if (this.pending) {
        throw new Error('Reconcile pending delivery summaries before closing a request.');
      }
      if (request.closed || request.status === 'Complete') {
        throw new Error('Only outstanding requests can be closed.');
      }
      const note = typeof reason === 'string' ? reason.trim() : '';
      if (!note) {
        throw new Error('A reason is required.');
      }
      if (!this.connected) {
        throw new Error('Restore the simulated connection before closing a request.');
      }

      request.closed = true;
      this.log(id, `Outstanding request closed: ${note}. Delivery records retained.`);
      this.reconcile();
    }
  }

  root.Workflow = Workflow;
  if (typeof module !== 'undefined') {
    module.exports = Workflow;
  }
})(typeof window === 'undefined' ? globalThis : window);
