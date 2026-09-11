import net from 'node:net';

/**
 * Asks the OS for a free local TCP port by briefly binding to port 0.
 * Used to give the embedded server a free `127.0.0.1` port in production,
 * where (unlike dev) nothing else needs to know the port number in advance
 * (see PLAN.md "Desktop shell").
 */
export function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.unref();
    probe.on('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      const port = typeof address === 'object' && address !== null ? address.port : null;
      probe.close(() => {
        if (port === null) reject(new Error('failed to determine a free port'));
        else resolve(port);
      });
    });
  });
}
