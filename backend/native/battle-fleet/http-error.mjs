/** Turn HyperBEAM's HTML error page into a compact diagnostic without
 * mistaking Erlang binary syntax (`<<"device">>`) for an HTML tag. */
export function httpFailureSummary(status, body) {
  const binaries = [];
  const decoded = String(body || '')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
  const protectedText = decoded.replace(/<<[\s\S]*?>>/g, (value) => {
    const marker = `RUNEREALM_ERLANG_BINARY_${binaries.length}_`;
    binaries.push(value);
    return marker;
  });
  const plain = protectedText
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/RUNEREALM_ERLANG_BINARY_(\d+)_/g,
      (_, index) => binaries[Number(index)] || '')
    .replace(/\s+/g, ' ')
    .trim();
  const detailAt = plain.search(/Termination type:|Error details:/i);
  const useful = detailAt >= 0 ? plain.slice(detailAt) : plain;
  return `${status} ${useful.slice(0, 1200)}`.trim();
}
