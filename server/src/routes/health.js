// GET /healthz — สถานะสำหรับ Docker HEALTHCHECK และการเฝ้าดู
export default async function healthRoutes(app, { getActiveStreams = () => 0, getMirror = () => null } = {}) {
  app.get('/healthz', async (_req, reply) => {
    reply.header('Cache-Control', 'no-store');
    return {
      ok: true,
      uptime: Math.round(process.uptime()),
      activeStreams: getActiveStreams(),
      mirror: getMirror(),
    };
  });
}
