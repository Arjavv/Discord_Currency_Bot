// In-memory request logger
const requestLogs = [];
const MAX_LOGS = 10;

function logRequest({ username, command, fulfilled, error = '' }) {
  requestLogs.unshift({
    timestamp: new Date().toISOString(),
    username,
    command,
    fulfilled,
    error
  });

  if (requestLogs.length > MAX_LOGS) {
    requestLogs.length = MAX_LOGS;
  }
}

function getLogs() {
  return requestLogs;
}

module.exports = {
  logRequest,
  getLogs
};
