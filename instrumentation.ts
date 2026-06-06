// This file runs before any other code in Next.js (both dev and prod)
// Used to set DNS servers before MongoDB SRV lookup happens

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const dns = await import('dns');
    dns.setServers(['8.8.8.8', '1.1.1.1']);
    console.log('[DNS] Forced to Google/Cloudflare DNS');
  }
}
