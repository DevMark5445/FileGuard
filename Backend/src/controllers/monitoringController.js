const { subscribeToMonitoring } = require("../services/monitoringStream");

function streamMonitoring(req, res) {
  res.status(200).set({
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.flushHeaders();
  res.write("retry: 3000\n\n");

  const unsubscribe = subscribeToMonitoring(req.user, res);
  const heartbeat = setInterval(() => {
    if (!res.destroyed && !res.writableEnded) res.write(": keep-alive\n\n");
  }, 20000);
  const cleanup = () => {
    clearInterval(heartbeat);
    unsubscribe();
  };

  res.once("close", cleanup);
  res.once("error", cleanup);
}

module.exports = { streamMonitoring };
