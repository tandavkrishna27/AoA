import { parseIpv6Words } from "./ip-literal.js";
function mappedIpv4(words: readonly number[]): string | null {
  if (
    words.length !== 8 ||
    words.slice(0, 5).some((word) => word !== 0) ||
    words[5] !== 0xffff
  ) {
    return null;
  }
  return [
    words[6]! >> 8,
    words[6]! & 0xff,
    words[7]! >> 8,
    words[7]! & 0xff,
  ].join(".");
}

// -- W17: THE IANA COVERAGE AUDIT, RECORDED BESIDE THE PREDICATE IT IS ABOUT --
//
// WHY IT IS HERE AND NOT IN A DOC. This audit existed only in a conversation. On
// 2026-09-08, `grep -rn IANA` over `server/src`, `scripts` and `docs/replatform`
// returned exactly ONE hit, and it was a timezone row in a QA template — so the
// registry this predicate is a rendering of was nowhere near the predicate. A
// reader deciding whether a range is missing looks HERE, at the `if` list below.
// The machine-checkable half of the audit is
// `server/src/__tests__/w17-ipv6-range-closeout.test.ts`, which carries the
// registry rows as data and FAILS if any Globally-Reachable-FALSE block stops
// being covered. This comment is the index; that file is the check.
//
// REGISTRIES, retrieved 2026-09-08 (sha256 of the CSV as served):
//   IPv4 Special-Purpose  https://www.iana.org/assignments/iana-ipv4-special-registry/iana-ipv4-special-registry-1.csv
//     e3e39e76d00b1677335db8e9a805c7b9480ea2f4dc9e33f0b93cd3a905128d73
//   IPv6 Special-Purpose  https://www.iana.org/assignments/iana-ipv6-special-registry/iana-ipv6-special-registry-1.csv
//     775feea0621dec8735a44fbf30f762e721e8f0a1b3ab7eb341961a88cfce2139
//
// RESULT 1 — IPv4 COVERAGE IS COMPLETE, ZERO GAPS. Every IPv4 special-purpose
// block whose registry `Globally Reachable` column is FALSE is inside this
// predicate's rejection set. Verified two ways: `w10c-internal-range-deny-set.test.ts`
// re-derives the EXACT MINIMAL CIDR COVER of the IPv4 arm by a full sweep of all
// 2^24 /24 blocks (plus a separate test that the verdict is constant across the
// fourth octet, which makes the pair exhaustive over all 2^32 addresses), and the
// W17 test intersects that cover with the pinned registry rows. The IPv4 arm was
// NOT touched by W17 and the blast-radius test proves it byte-for-byte in verdict
// terms: zero of the 2^32 addresses changed class.
//
// RESULT 2 — TWO IPv6 RANGES WERE MISSING, AND ARE ADDED BELOW.
//   5f00::/16       Segment Routing (SRv6) SIDs, RFC 9602, allocated 2024-04,
//                   registry Globally Reachable = FALSE. Nothing in this predicate
//                   matched `first === 0x5f00`; the whole /16 returned false.
//   100:0:0:1::/64  Dummy IPv6 Prefix, RFC 9780, allocated 2025-04, registry
//                   Globally Reachable = FALSE. The discard-only clause required
//                   `fourth === 0`, so this fell through to `return false` while
//                   the ADJACENT 100::/64 was blocked.
// Neither has a legitimate AoA destination: an SRv6 SID is a router-internal
// forwarding label inside the operator's own SR domain, and the Dummy Prefix is
// defined as a source/destination that must never be routed. See the PR body for
// the full allowed -> denied enumeration.
//
// RESULT 3 — ONE RANGE DELIBERATELY NOT ADDED: the unallocated remainder of
// 2001::/23 (IETF Protocol Assignments). The /23 superblock reads Globally
// Reachable = FALSE, but every ASSIGNED sub-block in the part this predicate does
// NOT cover reads TRUE: 2001:1::1/128 (PCP anycast, RFC 7723), 2001:1::2/128
// (TURN anycast, RFC 8155), 2001:1::3/128 (DNS-SD SRP anycast, RFC 9665),
// 2001:3::/32 (AMT, RFC 7450), 2001:4:112::/48 (AS112-v6, RFC 7535),
// 2001:30::/28 (DRIP DETs, RFC 9374). Covering the /23 would deny real, routed,
// globally reachable destinations to close nothing. Two independent audits
// examined it and both recommended against. Do not "complete" this range.
//
// ★ RESULT 4 — THE STRUCTURAL LIMIT A FUTURE READER MOST NEEDS. AN RFC 6052
// OPERATOR-CHOSEN NAT64 NETWORK-SPECIFIC PREFIX CANNOT BE CLOSED BY ANY PREFIX
// LIST, EVER. The clause below covers 64:ff9b::/96 (RFC 6052 well-known) and
// 64:ff9b:1::/48 (RFC 8215 local-use), because those are fixed. But RFC 6052 also
// lets an operator translate through a Network-Specific Prefix taken from their
// OWN global unicast allocation, at /32, /40, /48, /56, /64 or /96. That prefix is
// indistinguishable from any other address in their allocation: it is not in any
// registry, it is not reserved, and its embedded IPv4 destination is not
// syntactically marked. So an address inside such a prefix that translates to
// 169.254.169.254 is, to this predicate, an ordinary public IPv6 address — and no
// list of ranges added here can change that. This is a STRUCTURAL LIMIT OF THE
// PREFIX-LIST APPROACH, not a gap to be fixed: closing it needs a different
// mechanism (an egress allowlist, or refusing destinations the deployment has not
// named), which is the DAT-005 `classifyEgressDestination` allowlist gate, not
// this blocklist. Do not file it as a missing range; do not add a speculative
// range to "cover" it.

/**
 * Check if an IP address is in a private/reserved range (RFC 1918, loopback,
 * link-local, etc.) that outbound HTTP should never be able to reach.
 *
 * Handles IPv4-mapped IPv6 addresses (e.g. ::ffff:127.0.0.1) which Node's
 * dns.lookup may return depending on OS configuration.
 */
export function isPrivateIP(ip: string): boolean {
  const lower = ip.toLowerCase().replace(/^\[|\]$/g, "");

  // Unwrap IPv4-mapped IPv6 addresses (::ffff:x.x.x.x) and re-check as IPv4
  const v4MappedMatch = lower.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (v4MappedMatch && v4MappedMatch[1]) return isPrivateIP(v4MappedMatch[1]);
  const ipv6Words = parseIpv6Words(lower);
  const canonicalMapped = ipv6Words ? mappedIpv4(ipv6Words) : null;
  if (canonicalMapped) return isPrivateIP(canonicalMapped);

  // IPv4 patterns
  const octets = ip.split(".").map(Number);
  if (
    octets.length === 4 &&
    octets.every((part) => Number.isInteger(part) && part >= 0 && part <= 255)
  ) {
    const [first, second, third] = octets as [number, number, number, number];
    if (first === 0) return true; // current network / unspecified
    if (first === 100 && second >= 64 && second <= 127) return true; // carrier-grade NAT
    if (first === 192 && second === 0 && third === 0) return true; // IETF protocol assignments
    if (first === 192 && second === 0 && third === 2) return true; // TEST-NET-1
    if (first === 192 && second === 88 && third === 99) return true; // deprecated 6to4 relay
    if (first === 198 && (second === 18 || second === 19)) return true; // benchmarking
    if (first === 198 && second === 51 && third === 100) return true; // TEST-NET-2
    if (first === 203 && second === 0 && third === 113) return true; // TEST-NET-3
    if (first >= 224) return true; // multicast and reserved
  }
  if (ip.startsWith("10.")) return true;
  if (ip.startsWith("172.")) {
    const second = parseInt(ip.split(".")[1]!, 10);
    if (second >= 16 && second <= 31) return true;
  }
  if (ip.startsWith("192.168.")) return true;
  if (ip.startsWith("127.")) return true;                   // loopback
  if (ip.startsWith("169.254.")) return true;               // link-local
  if (ip === "0.0.0.0") return true;

  // IPv6 special-use ranges. Compare parsed words so compressed and canonical
  // forms receive identical treatment.
  if (ipv6Words) {
    const [first, second, third, fourth] = ipv6Words;
    if (first === 0) return true; // unspecified, loopback, IPv4-compatible
    if ((first! & 0xfe00) === 0xfc00) return true; // fc00::/7 ULA
    if ((first! & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
    if ((first! & 0xffc0) === 0xfec0) return true; // fec0::/10 deprecated site-local
    if ((first! & 0xff00) === 0xff00) return true; // ff00::/8 multicast
    if (
      first === 0x0064 &&
      second === 0xff9b &&
      (third === 0 || third === 1)
    ) {
      return true; // NAT64 translation prefixes
    }
    if (
      first === 0x0100 &&
      second === 0 &&
      third === 0 &&
      (fourth === 0 || fourth === 1)
    ) {
      // 100::/64        RFC 6666 discard-only sink route.
      // 100:0:0:1::/64  RFC 9780 Dummy Prefix (allocated 2025-04, registry
      //                 Globally Reachable = FALSE). W17: `fourth === 0` alone
      //                 let this ADJACENT /64 fall through to `return false`
      //                 while its neighbour was blocked.
      return true;
    }
    if (
      first === 0x2001 &&
      (second === 0 ||
        second === 0x0002 ||
        (second! >= 0x0010 && second! <= 0x002f) ||
        second === 0x0db8)
    ) {
      return true; // Teredo/benchmark/ORCHID/documentation
    }
    if (first === 0x2002) return true; // 2002::/16 6to4
    if (first! >= 0x3ff0 && first! <= 0x3fff) return true; // 3fff::/20 docs
    // 5f00::/16 SRv6 SIDs (RFC 9602, allocated 2024-04, registry Globally
    // Reachable = FALSE). W17: nothing in this predicate matched 0x5f00.
    if (first === 0x5f00) return true;
  }

  return false;
}

