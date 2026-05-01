let SIGNAL_STORE = [];

function generateId(sig) {
  return `${sig.name}-${Date.now()}`;
}

function isSameSignal(a, b) {
  return (
    a.type === b.type &&
    Math.abs(a.entry - b.entry) < 50
  );
}

function addSignals(newSignals) {
  const added = [];

  newSignals.forEach(function(sig) {
    var exists = SIGNAL_STORE.some(function(s) {
      return isSameSignal(s, sig);
    });
    if (exists) return;

    var now = Date.now();

    SIGNAL_STORE.push({
      ...sig,
      id: generateId(sig),
      status: "NEW",
      created_at: now,
      expire_at: now + 30 * 60 * 1000
    });

    added.push(sig);
  });

  return added;
}

function updateLifecycle(price) {
  SIGNAL_STORE = SIGNAL_STORE.map(function(sig) {
    if (Date.now() > sig.expire_at) {
      sig.status = "EXPIRED";
      return sig;
    }

    if (sig.status === "NEW" || sig.status === "READY") {
      if (Math.abs(price - sig.entry) < 300) {
        sig.status = "ACTIVE";
      } else {
        sig.status = "READY";
      }
    }

    if (sig.status === "ACTIVE") {
      if (sig.type === "LONG") {
        if (price >= sig.tp) sig.status = "TP";
        if (price <= sig.sl) sig.status = "SL";
      }
      if (sig.type === "SHORT") {
        if (price <= sig.tp) sig.status = "TP";
        if (price >= sig.sl) sig.status = "SL";
      }
    }

    if (sig.status === "TP") {
      sig.status = "RE-ENTRY";
    }

    return sig;
  });

  return SIGNAL_STORE;
}

module.exports = { addSignals: addSignals, updateLifecycle: updateLifecycle };