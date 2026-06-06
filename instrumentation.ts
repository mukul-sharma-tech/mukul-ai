// This file runs before any other code in Next.js (both dev and prod)
// Used to set DNS servers before MongoDB SRV lookup happens

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const dns = await import('dns');
    dns.setServers(['8.8.8.8', '1.1.1.1']);
    console.log('[DNS] Forced to Google/Cloudflare DNS');

    // ── Env var check on startup ──────────────────────────
    const checks: { name: string; required: boolean }[] = [
      { name: 'MONGO_URI',                    required: true  },
      { name: 'Groq_API_1',                   required: true  },
      { name: 'Groq_API_2',                   required: false },
      { name: 'gemini_api',                   required: false },
      { name: 'GOOGLE_SERVICE_ACCOUNT_JSON',  required: true  },
      { name: 'HF_TOKEN',                     required: false },
      { name: 'GITHUB_TOKEN',                 required: false },
    ];

    console.log('\n─── Startup Env Check ───────────────────────────');
    for (const { name, required } of checks) {
      const val = process.env[name];
      if (val && val.length > 0) {
        // Print first 10 chars so you can verify it's the right key
        console.log(`  ✅ ${name}: set (${val.slice(0, 12)}...)`);
      } else if (required) {
        console.warn(`  ❌ ${name}: MISSING (required)`);
      } else {
        console.log(`  ⚠️  ${name}: not set (optional)`);
      }
    }
    console.log('─────────────────────────────────────────────────\n');
  }
}
