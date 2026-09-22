/**
 * API Documentation page — faithful port of the frontend's ApiDocsStep.
 *
 * Strings are taken verbatim from the frontend's en/companies.json.
 * The live apiBaseUrl comes from the stored connection profile.
 */

import { useState } from "react";
import {
  AlertTriangle,
  Ban,
  Code2,
  FileDown,
  Fingerprint,
  KeyRound,
  ListTree,
  Loader2,
  RefreshCw,
  Repeat,
  Route,
  ScanSearch,
  Zap,
} from "lucide-react";

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CodeBlock } from "@/components/ui/code-block";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { save } from "@tauri-apps/plugin-dialog";
import { writeFile } from "@tauri-apps/plugin-fs";
import { useStoredCredentials } from "@/lib/api";
import { cn } from "@/lib/utils";

// ──────────────────────────────────────────────────────── Sample text ─────

const SAMPLE_TEXT = "Merhaba, sözleşme taslağını ekte gönderiyorum.";

// ──────────────────────────────────────────────────────── Code samples ────

const curl = (base: string) =>
  `curl -X POST ${base}/v1/analyze \\
  -H "Authorization: Bearer $CONFINAID_ACCESS_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{"content": "${SAMPLE_TEXT}"}'`;

const node = (base: string) =>
  `// 1. Exchange the credential for an access token (cache it for its lifetime).
async function getAccessToken() {
  const res = await fetch("${base}/v1/token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: process.env.CONFINAID_CLIENT_ID,
      client_secret: process.env.CONFINAID_CLIENT_SECRET,
    }),
  });
  if (!res.ok) throw new Error("Confinaid: token exchange failed");
  const { access_token } = await res.json();
  return access_token;
}

// 2. Analyze content.
async function analyze(content) {
  const res = await fetch("${base}/v1/analyze", {
    method: "POST",
    headers: {
      Authorization: \`Bearer \${await getAccessToken()}\`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ content }),
  });
  if (res.status === 429) throw new Error("Confinaid: quota exhausted");
  if (!res.ok) throw new Error(\`Confinaid: \${res.status}\`);
  return res.json();
}

const result = await analyze("${SAMPLE_TEXT}");
console.log(result.is_risky, result.risk_score, result.findings);`;

const python = (base: string) =>
  `import os, requests

def get_access_token():
    res = requests.post("${base}/v1/token", json={
        "client_id": os.environ["CONFINAID_CLIENT_ID"],
        "client_secret": os.environ["CONFINAID_CLIENT_SECRET"],
    }, timeout=10)
    res.raise_for_status()
    return res.json()["access_token"]

def analyze(content):
    res = requests.post("${base}/v1/analyze",
        headers={"Authorization": f"Bearer {get_access_token()}"},
        json={"content": content}, timeout=30)
    if res.status_code == 429:
        raise RuntimeError("Confinaid: quota exhausted")
    res.raise_for_status()
    return res.json()

result = analyze("${SAMPLE_TEXT}")
print(result["is_risky"], result["risk_score"], result["findings"])`;

const php = (base: string) =>
  `<?php
function confinaid_access_token(): string {
    $ch = curl_init('${base}/v1/token');
    curl_setopt_array($ch, [
        CURLOPT_POST           => true,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_HTTPHEADER     => ['Content-Type: application/json'],
        CURLOPT_POSTFIELDS     => json_encode([
            'client_id'     => getenv('CONFINAID_CLIENT_ID'),
            'client_secret' => getenv('CONFINAID_CLIENT_SECRET'),
        ]),
    ]);
    $body = curl_exec($ch);
    curl_close($ch);
    return json_decode($body, true)['access_token'];
}

function confinaid_analyze(string $content): array {
    $ch = curl_init('${base}/v1/analyze');
    curl_setopt_array($ch, [
        CURLOPT_POST           => true,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_HTTPHEADER     => [
            'Authorization: Bearer ' . confinaid_access_token(),
            'Content-Type: application/json',
        ],
        CURLOPT_POSTFIELDS => json_encode(['content' => $content]),
    ]);
    $body   = curl_exec($ch);
    $status = curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
    curl_close($ch);
    if ($status === 429) throw new RuntimeException('Confinaid: quota exhausted');
    if ($status !== 200) throw new RuntimeException("Confinaid: {$status}");
    return json_decode($body, true);
}

$result = confinaid_analyze('${SAMPLE_TEXT}');
var_dump($result['is_risky'], $result['risk_score']);`;

const go = (base: string) =>
  `package confinaid

import (
    "bytes"
    "encoding/json"
    "fmt"
    "net/http"
    "os"
)

func AccessToken() (string, error) {
    payload, _ := json.Marshal(map[string]string{
        "client_id":     os.Getenv("CONFINAID_CLIENT_ID"),
        "client_secret": os.Getenv("CONFINAID_CLIENT_SECRET"),
    })
    res, err := http.Post("${base}/v1/token", "application/json", bytes.NewReader(payload))
    if err != nil { return "", err }
    defer res.Body.Close()
    var out struct { AccessToken string \`json:"access_token"\` }
    json.NewDecoder(res.Body).Decode(&out)
    return out.AccessToken, nil
}

func Analyze(content string) (map[string]any, error) {
    token, _ := AccessToken()
    payload, _ := json.Marshal(map[string]string{"content": content})
    req, _ := http.NewRequest("POST", "${base}/v1/analyze", bytes.NewReader(payload))
    req.Header.Set("Authorization", "Bearer "+token)
    req.Header.Set("Content-Type", "application/json")
    res, err := http.DefaultClient.Do(req)
    if err != nil { return nil, err }
    defer res.Body.Close()
    if res.StatusCode == 429 { return nil, fmt.Errorf("quota exhausted") }
    var out map[string]any
    return out, json.NewDecoder(res.Body).Decode(&out)
}`;

const java = (base: string) =>
  `import java.net.URI;
import java.net.http.*;

public final class Confinaid {
    private static final HttpClient CLIENT = HttpClient.newHttpClient();

    static String accessToken() throws Exception {
        var body = """
            {"client_id": "%s", "client_secret": "%s"}
            """.formatted(
                System.getenv("CONFINAID_CLIENT_ID"),
                System.getenv("CONFINAID_CLIENT_SECRET"));
        var req = HttpRequest.newBuilder()
            .uri(URI.create("${base}/v1/token"))
            .header("Content-Type", "application/json")
            .POST(HttpRequest.BodyPublishers.ofString(body)).build();
        var res = CLIENT.send(req, HttpResponse.BodyHandlers.ofString());
        if (res.statusCode() != 200)
            throw new IllegalStateException("token exchange failed");
        return JsonParser.readString(res.body(), "access_token");
    }

    static String analyze(String content) throws Exception {
        var req = HttpRequest.newBuilder()
            .uri(URI.create("${base}/v1/analyze"))
            .header("Authorization", "Bearer " + accessToken())
            .header("Content-Type", "application/json")
            .POST(HttpRequest.BodyPublishers.ofString(
                "{\\"content\\": \\"" + content + "\\"}")).build();
        var res = CLIENT.send(req, HttpResponse.BodyHandlers.ofString());
        if (res.statusCode() == 429)
            throw new IllegalStateException("quota exhausted");
        return res.body();
    }
}`;

const csharp = (base: string) =>
  `using System.Net;
using System.Net.Http.Json;
using System.Text.Json;

public static class Confinaid {
    private static readonly HttpClient Client = new();

    public static async Task<string> GetAccessTokenAsync() {
        var res = await Client.PostAsJsonAsync("${base}/v1/token", new {
            client_id = Environment.GetEnvironmentVariable("CONFINAID_CLIENT_ID"),
            client_secret = Environment.GetEnvironmentVariable("CONFINAID_CLIENT_SECRET"),
        });
        if (!res.IsSuccessStatusCode)
            throw new InvalidOperationException("token exchange failed");
        var payload = await res.Content.ReadFromJsonAsync<JsonElement>();
        return payload.GetProperty("access_token").GetString()!;
    }

    public static async Task<JsonElement> AnalyzeAsync(string content) {
        using var req = new HttpRequestMessage(HttpMethod.Post, "${base}/v1/analyze") {
            Content = JsonContent.Create(new { content }),
        };
        req.Headers.Authorization = new("Bearer", await GetAccessTokenAsync());
        var res = await Client.SendAsync(req);
        if (res.StatusCode == HttpStatusCode.TooManyRequests)
            throw new InvalidOperationException("quota exhausted");
        res.EnsureSuccessStatusCode();
        return await res.Content.ReadFromJsonAsync<JsonElement>();
    }
}`;

const CODE_SAMPLES = [
  { label: "cURL", filename: "analyze.sh", build: curl },
  { label: "Node.js", filename: "confinaid.mjs", build: node },
  { label: "Python", filename: "confinaid.py", build: python },
  { label: "PHP", filename: "confinaid.php", build: php },
  { label: "Go", filename: "confinaid.go", build: go },
  { label: "Java", filename: "Confinaid.java", build: java },
  { label: "C#", filename: "Confinaid.cs", build: csharp },
] as const;

// ──────────────────────────────────────────────────────── Static snippets ─

const TOKEN_REQUEST = `POST /v1/token
Content-Type: application/json

{
  "client_id": "cid_QbX_SoUTUbWMrUWhd2joxmFg",
  "client_secret": "csk_…"
}`;

const TOKEN_RESPONSE = `{
  "access_token": "cat_…",
  "refresh_token": "crt_…",
  "token_type": "Bearer",
  "expires_in": 3600,
  "scope": "analyze rewrite"
}`;

const TOKEN_ERROR = `{
  "error": "invalid_client",
  "error_description": "Client authentication failed.",
  "request_id": "9f2c1e7b4a6d5083c1f9ab2d7e4c6081"
}`;

const REFRESH_REQUEST = `POST /v1/token/refresh
Content-Type: application/json

{
  "refresh_token": "crt_…"
}`;

const REVOKE_REQUEST = `POST /v1/token/revoke
Content-Type: application/json

{
  "token": "cat_…"
}`;

const buildAnalyzeRequest = (base: string) =>
  `POST ${base}/v1/analyze
Authorization: Bearer <ACCESS_TOKEN>
Content-Type: application/json
X-Request-ID: 8f3c1b2a

{
  "content": "${SAMPLE_TEXT}"
}`;

const ANALYZE_RESPONSE = `{
  "request_id": "8f3c1b2a",
  "analysis_id": "c0ffee11-2233-4455-6677-8899aabbccdd",
  "is_risky": true,
  "risk_score": 0.82,
  "language": "tr",
  "findings": [
    {
      "start": 9,
      "end": 26,
      "label_id": "CF-TAX-V1-00068",
      "label_title": "Sözleşme",
      "label_path": "Ticari > Sözleşme",
      "quote": "sözleşme taslağı"
    }
  ],
  "usage": { "remaining": -1 }
}`;

const buildRewriteRequest = (base: string) =>
  `POST ${base}/v1/rewrite
Authorization: Bearer <ACCESS_TOKEN>
Content-Type: application/json

{
  "content": "${SAMPLE_TEXT}",
  "analysis_id": "c0ffee11-2233-4455-6677-8899aabbccdd"
}`;

const REWRITE_RESPONSE = `{
  "request_id": "1d94ff70",
  "analysis_id": "c0ffee11-2233-4455-6677-8899aabbccdd",
  "rewritten_text": "Merhaba, sözleşme taslağını ekte paylaşıyorum.",
  "usage": { "remaining": -1 }
}`;

// GraphRAG — a plain GET; analysis_id goes in the query string, no body.
const GRAPHRAG_REQUEST = `GET /v1/graphrag?analysis_id=c0ffee11-2233-4455-6677-8899aabbccdd
Authorization: Bearer <ACCESS_TOKEN>
X-Request-ID: 3a71ce90`;

// analysis_text is Markdown — the \n sequences are the two characters a JSON
// document actually holds, not real line breaks.
const GRAPHRAG_RESPONSE = `{
  "request_id": "3a71ce90",
  "analysis_id": "c0ffee11-2233-4455-6677-8899aabbccdd",
  "analysis_text": "## Özet\\n\\nSözleşme taslağı üçüncü bir tarafla paylaşılıyor; ticari şartlar metinde açıkta.",
  "usage": { "remaining": -1 }
}`;

const ERROR_ENVELOPE = `{
  "error": {
    "code": "quota_exceeded",
    "message": "Your usage quota for this operation has been exhausted.",
    "request_id": "9f2c1e7b4a6d5083c1f9ab2d7e4c6081"
  }
}`;

const buildCorrelationExample = (base: string) =>
  `# Send your own id...
curl -i -X POST ${base}/v1/analyze \\
  -H "Authorization: Bearer $CONFINAID_ACCESS_TOKEN" \\
  -H "Content-Type: application/json" \\
  -H "X-Request-ID: order-4417-retry-2" \\
  -d '{"content": "…"}'

# ...and it comes straight back, on success and on failure alike.
HTTP/1.1 429 Too Many Requests
X-Request-ID: order-4417-retry-2
Retry-After: 3600

{"error":{"code":"quota_exceeded","message":"…","request_id":"order-4417-retry-2"}}`;

// ──────────────────────────────────────────────────────── Error table data ─

const ERROR_ROWS = [
  { status: "400", code: "invalid_request", retryable: false },
  { status: "401", code: "unauthorized", retryable: false },
  { status: "402", code: "payment_required", retryable: false },
  { status: "403", code: "forbidden", retryable: false },
  { status: "403", code: "feature_disabled", retryable: false },
  { status: "404", code: "not_found", retryable: false },
  { status: "405", code: "method_not_allowed", retryable: false },
  { status: "413", code: "payload_too_large", retryable: false },
  { status: "415", code: "unsupported_media_type", retryable: false },
  { status: "429", code: "rate_limited", retryable: true },
  { status: "429", code: "quota_exceeded", retryable: false },
  { status: "500", code: "internal_error", retryable: true },
  { status: "501", code: "not_implemented", retryable: false },
  { status: "502", code: "upstream_unavailable", retryable: true },
  { status: "504", code: "upstream_timeout", retryable: true },
] as const;

// Exact strings from frontend en/companies.json › docs.errorCodes
const ERROR_MEANINGS: Record<string, string> = {
  invalid_request: "The body is malformed or a required field is missing.",
  unauthorized: "The access token is missing, invalid, expired or revoked.",
  forbidden: "Your licence or the credential's scopes do not cover this operation.",
  feature_disabled:
    "The licence and scopes are fine, but the customer has switched this capability off on its filtering profile. It has to be turned back on in the dashboard.",
  payment_required:
    "No API pricing plan is configured for the account, so usage cannot be billed and the request is refused. Only the account owner can clear it, by agreeing a tariff with Confinaid.",
  not_found:
    "The referenced record does not exist. An analysis_id belonging to another customer is answered the same way.",
  method_not_allowed:
    "The endpoint exists but does not accept this HTTP method. Check the verb for the endpoint you are calling.",
  payload_too_large: "The request body exceeds 1 MiB.",
  unsupported_media_type: "Content-Type was not application/json.",
  rate_limited:
    "The request rate limit was exceeded. Transient — wait out Retry-After and try again.",
  quota_exceeded:
    "Your licensed quota is exhausted. Retrying will not fix it — it needs a plan change or the quota window to reset.",
  internal_error: "Something failed on our side. Safe to retry with backoff.",
  not_implemented: "The operation is recognised but not yet available.",
  upstream_unavailable: "A dependency was unreachable. The request was not processed.",
  upstream_timeout: "A dependency took too long. The request was not processed.",
};

// ──────────────────────────────────────────────────────── Section heading ─

function DocsHeading({
  icon,
  title,
  description,
}: {
  icon?: React.ReactNode;
  title: string;
  description?: string;
}) {
  return (
    <div className="space-y-1">
      <h3 className="flex items-center gap-2 text-sm font-semibold">
        {icon}
        {title}
      </h3>
      {description && (
        <p className="text-muted-foreground text-xs leading-relaxed">{description}</p>
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────── Method badges ──

const POST_BADGE =
  "inline-flex shrink-0 items-center rounded-md border px-2 py-0.5 font-mono text-[10px] font-bold tracking-wider bg-emerald-500/15 text-emerald-600 border-emerald-500/30 dark:text-emerald-400";

const GET_BADGE =
  "inline-flex shrink-0 items-center rounded-md border px-2 py-0.5 font-mono text-[10px] font-bold tracking-wider bg-sky-500/15 text-sky-600 border-sky-500/30 dark:text-sky-400";

// ──────────────────────────────────────────────────────── Page ────────────

export function DocsPage() {
  const stored = useStoredCredentials();
  const apiBase = stored.data?.apiBaseUrl?.replace(/\/$/, "") ?? "https://api.confinaid.com";

  const [openPanels, setOpenPanels] = useState<string[]>([]);

  const [isDownloading, setIsDownloading] = useState(false);

  const handleDownload = async () => {
    setIsDownloading(true);
    try {
      // Fetch the bundled PDF as raw bytes.
      const res = await fetch("/api-docs.pdf");
      const buffer = await res.arrayBuffer();

      // Ask the user where to save it.
      const filePath = await save({
        defaultPath: "Confinaid API Documentation.pdf",
        filters: [{ name: "PDF Document", extensions: ["pdf"] }],
      });

      if (!filePath) return; // user cancelled

      // Write the bytes to the chosen path.
      await writeFile(filePath, new Uint8Array(buffer));
    } finally {
      setIsDownloading(false);
    }
  };

  return (
    <div className="mx-auto max-w-3xl space-y-8 px-1 py-4 pb-12">
      {/* ── Page title + intro + download ──────────────────────────── */}
      <div className="space-y-3">
        <div className="space-y-1">
          <h2 className="text-lg font-semibold">Documentation</h2>
          <p className="text-muted-foreground text-sm">
            Endpoints, authentication flow, error codes and example requests for the Confinaid API.
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-muted-foreground text-xs leading-relaxed">
            Every section is expanded and your browser's print dialog opens — pick "Save as PDF" as
            the destination.
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 shrink-0 gap-1.5"
            onClick={() => void handleDownload()}
            disabled={isDownloading}
          >
            {isDownloading ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <FileDown className="size-3.5" />
            )}
            Download as PDF
          </Button>
        </div>
      </div>

      {/* ── How it works ───────────────────────────────────────────── */}
      <section className="space-y-3">
        <DocsHeading
          icon={<Route className="text-muted-foreground size-4" />}
          title="How it works"
        />
        <div className="grid gap-3 sm:grid-cols-3">
          {[
            {
              Icon: KeyRound,
              title: "Create a credential",
              body: "A client ID and secret, issued once from the previous step.",
            },
            {
              Icon: Repeat,
              title: "Exchange for a token",
              body: "Trade them for a short-lived access token and a refresh token.",
            },
            {
              Icon: Zap,
              title: "Call the API",
              body: "Send the access token as a Bearer header on every request.",
            },
          ].map(({ Icon, title, body }, index) => (
            <div key={title} className="bg-muted/20 flex gap-3 rounded-lg border p-3">
              <div className="bg-primary/10 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg">
                <Icon className="text-primary size-4" />
              </div>
              <div className="min-w-0 space-y-0.5">
                <p className="text-xs font-semibold">
                  {index + 1}. {title}
                </p>
                <p className="text-muted-foreground text-xs leading-relaxed">{body}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ── Integration code ───────────────────────────────────────── */}
      <section className="space-y-3">
        <DocsHeading
          icon={<Code2 className="text-muted-foreground size-4" />}
          title="Integration code"
          description="Copy one of these into your backend. Each snippet exchanges the credential for an access token and then analyzes a piece of content — read the client id and secret from environment variables rather than hardcoding them."
        />
        <Tabs defaultValue="cURL">
          <TabsList className="h-auto flex-wrap justify-start gap-1">
            {CODE_SAMPLES.map((s) => (
              <TabsTrigger key={s.label} value={s.label}>
                {s.label}
              </TabsTrigger>
            ))}
          </TabsList>
          {CODE_SAMPLES.map((s) => (
            <TabsContent key={s.label} value={s.label} className="mt-3">
              <CodeBlock code={s.build(apiBase)} title={s.filename} />
            </TabsContent>
          ))}
        </Tabs>
      </section>

      {/* ── Headers ────────────────────────────────────────────────── */}
      <section className="space-y-3">
        <DocsHeading
          icon={<ListTree className="text-muted-foreground size-4" />}
          title="Headers"
          description="Sent on every call to the API. The token endpoint takes only Content-Type — it is authenticated by the credentials in the body, not by a header."
        />
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="space-y-2">
            <p className="text-muted-foreground text-xs font-medium">Request</p>
            <div className="overflow-x-auto rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Header</TableHead>
                    <TableHead className="w-24">Required</TableHead>
                    <TableHead>Description</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {[
                    {
                      name: "Authorization",
                      required: true,
                      desc: "Bearer <access_token> — the token from the exchange.",
                    },
                    {
                      name: "Content-Type",
                      required: true,
                      desc: "application/json on any call that sends a body; other types are rejected with 415. Leave it off a GET — there is no body to describe.",
                    },
                    {
                      name: "X-Request-ID",
                      required: false,
                      desc: "Your own correlation id. Generated for you when omitted; capped at 128 chars of [A-Za-z0-9._-].",
                    },
                  ].map((h) => (
                    <TableRow key={h.name}>
                      <TableCell>
                        <code className="font-mono text-xs">{h.name}</code>
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={h.required ? "default" : "outline"}
                          className="text-[10px] font-normal"
                        >
                          {h.required ? "Required" : "Optional"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-muted-foreground text-xs">{h.desc}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
          <div className="space-y-2">
            <p className="text-muted-foreground text-xs font-medium">Response</p>
            <div className="overflow-x-auto rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Header</TableHead>
                    <TableHead className="w-20">When</TableHead>
                    <TableHead>Description</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {[
                    {
                      name: "X-Request-ID",
                      when: "Always",
                      desc: "Correlation id for this call. Quote it in support tickets.",
                    },
                    {
                      name: "Retry-After",
                      when: "On 429",
                      desc: "Seconds to wait before retrying once quota is exhausted.",
                    },
                    {
                      name: "WWW-Authenticate",
                      when: "On 401",
                      desc: "Present on a 401, describing the authentication scheme the endpoint expects.",
                    },
                  ].map((h) => (
                    <TableRow key={h.name}>
                      <TableCell>
                        <code className="font-mono text-xs">{h.name}</code>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-[10px] font-normal">
                          {h.when}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-muted-foreground text-xs">{h.desc}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        </div>
      </section>

      {/* ── Endpoints ──────────────────────────────────────────────── */}
      <section className="space-y-3">
        <DocsHeading icon={<Zap className="text-muted-foreground size-4" />} title="Endpoints" />

        <p className="text-muted-foreground text-xs font-medium">Authentication</p>

        <Accordion
          type="multiple"
          value={openPanels}
          onValueChange={setOpenPanels}
          className="space-y-2"
        >
          {/* Token */}
          <AccordionItem
            value="token"
            className="relative overflow-hidden rounded-lg border last:border-b"
          >
            <span
              aria-hidden
              className="absolute inset-y-0 left-0 w-1 rounded-l-lg bg-emerald-500"
            />
            <AccordionTrigger className="gap-3 px-4 py-3 hover:no-underline">
              <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1">
                <span className={POST_BADGE}>POST</span>
                <code className="font-mono text-sm font-semibold">/v1/token</code>
                <span className="text-muted-foreground min-w-0 truncate text-xs font-normal">
                  Exchange client credentials for an access token
                </span>
              </span>
            </AccordionTrigger>
            <AccordionContent className="space-y-3 px-4 pb-4">
              <p className="text-muted-foreground text-xs leading-relaxed">
                Post your client ID and secret to the token endpoint. The access token is valid for
                one hour; refresh it rather than re-sending the secret.
              </p>
              <CodeBlock code={TOKEN_REQUEST} title="Request" />
              <CodeBlock code={TOKEN_RESPONSE} title="200 · Response" />
              <CodeBlock code={TOKEN_ERROR} title="401 · Response" />
              <p className="text-muted-foreground text-xs leading-relaxed">
                The token endpoints answer with the RFC 6749 §5.2 shape instead of the error
                envelope every other endpoint uses, so off-the-shelf OAuth2 client libraries can
                parse them. An unknown client_id and a wrong client_secret are reported identically,
                so the endpoint cannot be used to enumerate valid client ids. Transport-level
                failures (429, 5xx) still use the standard envelope.
              </p>
            </AccordionContent>
          </AccordionItem>

          {/* Refresh */}
          <AccordionItem
            value="refresh"
            className="relative overflow-hidden rounded-lg border last:border-b"
          >
            <span
              aria-hidden
              className="absolute inset-y-0 left-0 w-1 rounded-l-lg bg-emerald-500"
            />
            <AccordionTrigger className="gap-3 px-4 py-3 hover:no-underline">
              <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1">
                <span className={POST_BADGE}>POST</span>
                <code className="font-mono text-sm font-semibold">/v1/token/refresh</code>
                <span className="text-muted-foreground min-w-0 truncate text-xs font-normal">
                  Exchange a refresh token for a new token pair
                </span>
              </span>
            </AccordionTrigger>
            <AccordionContent className="space-y-3 px-4 pb-4">
              <p className="text-muted-foreground text-xs leading-relaxed">
                Refresh tokens are single-use — each refresh returns a new pair and invalidates the
                old one.
              </p>
              <CodeBlock code={REFRESH_REQUEST} title="Request" />
              <CodeBlock code={TOKEN_RESPONSE} title="200 · Response" />
              <div className="flex gap-3 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
                <AlertTriangle className="size-4 shrink-0 text-amber-500" />
                <p className="text-muted-foreground text-xs leading-relaxed">
                  Replaying an already-used refresh token is treated as a leak: every token for that
                  credential is revoked, and you have to exchange the client secret again.
                </p>
              </div>
            </AccordionContent>
          </AccordionItem>

          {/* Revoke */}
          <AccordionItem
            value="revoke"
            className="relative overflow-hidden rounded-lg border last:border-b"
          >
            <span
              aria-hidden
              className="absolute inset-y-0 left-0 w-1 rounded-l-lg bg-emerald-500"
            />
            <AccordionTrigger className="gap-3 px-4 py-3 hover:no-underline">
              <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1">
                <span className={POST_BADGE}>POST</span>
                <code className="font-mono text-sm font-semibold">/v1/token/revoke</code>
                <span className="text-muted-foreground min-w-0 truncate text-xs font-normal">
                  Revoke an access or refresh token
                </span>
              </span>
            </AccordionTrigger>
            <AccordionContent className="space-y-3 px-4 pb-4">
              <p className="text-muted-foreground text-xs leading-relaxed">
                Makes a token unusable immediately. Send either an access or a refresh token — the
                service works out which it is. Call this the moment a token leaks.
              </p>
              <CodeBlock code={REVOKE_REQUEST} title="Request" />
              <p className="bg-muted/20 text-muted-foreground rounded-lg border px-3 py-2.5 font-mono text-xs">
                204 No Content
              </p>
              <p className="text-muted-foreground text-xs leading-relaxed">
                It always answers 204, including for a token that does not exist. Reporting "not
                found" would turn this endpoint into an oracle for checking whether a token is
                valid, so a 204 means "this token is not usable any more", not "a token was found
                and revoked". Revoking a refresh token does not revoke the access tokens already
                issued from it — revoke those too, or rotate the credential in the dashboard to
                invalidate everything at once.
              </p>
            </AccordionContent>
          </AccordionItem>
        </Accordion>

        <p className="text-muted-foreground pt-2 text-xs font-medium">Confinaid API</p>

        <Accordion
          type="multiple"
          value={openPanels}
          onValueChange={setOpenPanels}
          className="space-y-2"
        >
          {/* Analyze */}
          <AccordionItem
            value="analyze"
            className="relative overflow-hidden rounded-lg border last:border-b"
          >
            <span
              aria-hidden
              className="absolute inset-y-0 left-0 w-1 rounded-l-lg bg-emerald-500"
            />
            <AccordionTrigger className="gap-3 px-4 py-3 hover:no-underline">
              <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1">
                <span className={POST_BADGE}>POST</span>
                <code className="font-mono text-sm font-semibold">/v1/analyze</code>
                <span className="text-muted-foreground min-w-0 truncate text-xs font-normal">
                  Analyze content for risk
                </span>
              </span>
            </AccordionTrigger>
            <AccordionContent className="space-y-3 px-4 pb-4">
              <p className="text-muted-foreground text-xs leading-relaxed">
                Analyze content and get back a risk score with the individual findings, positioned
                in the text.
              </p>
              <CodeBlock code={buildAnalyzeRequest(apiBase)} title="Request" />
              <CodeBlock code={ANALYZE_RESPONSE} title="200 · Response" />
            </AccordionContent>
          </AccordionItem>

          {/* Rewrite */}
          <AccordionItem
            value="rewrite"
            className="relative overflow-hidden rounded-lg border last:border-b"
          >
            <span
              aria-hidden
              className="absolute inset-y-0 left-0 w-1 rounded-l-lg bg-emerald-500"
            />
            <AccordionTrigger className="gap-3 px-4 py-3 hover:no-underline">
              <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1">
                <span className={POST_BADGE}>POST</span>
                <code className="font-mono text-sm font-semibold">/v1/rewrite</code>
                <span className="text-muted-foreground min-w-0 truncate text-xs font-normal">
                  Rewrite content into a safer version
                </span>
              </span>
            </AccordionTrigger>
            <AccordionContent className="space-y-3 px-4 pb-4">
              <p className="text-muted-foreground text-xs leading-relaxed">
                Rewrite content into a safer version. Pass an{" "}
                <code className="font-mono text-xs">analysis_id</code> to ground the rewrite in a
                previous analysis.
              </p>
              <CodeBlock code={buildRewriteRequest(apiBase)} title="Request" />
              <CodeBlock code={REWRITE_RESPONSE} title="200 · Response" />
            </AccordionContent>
          </AccordionItem>

          {/* GraphRAG — listed last because analyze produces the analysis_id,
              rewrite consumes it optionally, and this consumes it exclusively.
              It is also the only read (GET) endpoint. */}
          <AccordionItem
            value="graphrag"
            className="relative overflow-hidden rounded-lg border last:border-b"
          >
            <span aria-hidden className="absolute inset-y-0 left-0 w-1 rounded-l-lg bg-sky-500" />
            <AccordionTrigger className="gap-3 px-4 py-3 hover:no-underline">
              <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1">
                <span className={GET_BADGE}>GET</span>
                <code className="font-mono text-sm font-semibold">/v1/graphrag</code>
                <span className="text-muted-foreground min-w-0 truncate text-xs font-normal">
                  Fetch the stored GraphRAG reasoning for an analysis
                </span>
              </span>
            </AccordionTrigger>
            <AccordionContent className="space-y-3 px-4 pb-4">
              <p className="text-muted-foreground text-xs leading-relaxed">
                Read back the GraphRAG reasoning Confinaid produced for an analysis — a short
                written assessment, in Markdown. It is a plain read: the{" "}
                <code className="font-mono text-xs">analysis_id</code> goes in the query string and
                there is no request body. The reasoning is produced in the background as soon as an
                analysis completes, so it is normally waiting for you; when it is not, it is
                produced on demand instead, which is slower but always answers. An id the service
                does not know, or one belonging to another customer, is answered with 404.
              </p>
              <div className="flex gap-3 rounded-lg border border-sky-500/30 bg-sky-500/5 p-3">
                <ScanSearch className="size-4 shrink-0 text-sky-500" />
                <p className="text-muted-foreground text-xs leading-relaxed">
                  No <code className="font-mono text-xs">Content-Type</code> header — this is a GET
                  with no body. Sending one is not an error, but leaving it off is the correct
                  approach.
                </p>
              </div>
              <CodeBlock code={GRAPHRAG_REQUEST} title="Request" />
              <CodeBlock code={GRAPHRAG_RESPONSE} title="200 · Response" />
            </AccordionContent>
          </AccordionItem>
        </Accordion>

        <Accordion
          type="multiple"
          value={openPanels}
          onValueChange={setOpenPanels}
          className="space-y-2 pt-2"
        >
          {/* Errors */}
          <AccordionItem value="errors" className="overflow-hidden rounded-lg border last:border-b">
            <AccordionTrigger className="px-4 py-3 text-sm font-medium hover:no-underline">
              Errors
            </AccordionTrigger>
            <AccordionContent className="space-y-3 px-4 pb-4">
              <p className="text-muted-foreground text-xs leading-relaxed">
                Every error uses the same envelope: a stable machine-readable code plus a
                human-readable message.
              </p>
              <CodeBlock code={ERROR_ENVELOPE} title="Error body" />
              <div className="overflow-x-auto rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-16">Status</TableHead>
                      <TableHead className="w-48">Code</TableHead>
                      <TableHead className="w-20">Handling</TableHead>
                      <TableHead>Meaning</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {ERROR_ROWS.map((row) => (
                      <TableRow key={row.code}>
                        <TableCell className="font-mono text-xs font-medium">
                          {row.status}
                        </TableCell>
                        <TableCell>
                          <code className="font-mono text-xs">{row.code}</code>
                        </TableCell>
                        <TableCell>
                          <span
                            className={cn(
                              "inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-medium",
                              row.retryable
                                ? "border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400"
                                : "border-border bg-muted/40 text-muted-foreground"
                            )}
                          >
                            {row.retryable ? (
                              <>
                                <RefreshCw className="size-2.5" />
                                Retry
                              </>
                            ) : (
                              <>
                                <Ban className="size-2.5" />
                                Fix
                              </>
                            )}
                          </span>
                        </TableCell>
                        <TableCell className="text-muted-foreground text-xs">
                          {ERROR_MEANINGS[row.code]}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <p className="text-muted-foreground text-xs leading-relaxed">
                New codes may be added over time. Branch on the HTTP status, treat an unrecognised
                code as its status implies, and never parse `message` — it is written for humans and
                can change without notice.
              </p>
            </AccordionContent>
          </AccordionItem>

          {/* Correlation */}
          <AccordionItem
            value="correlation"
            className="overflow-hidden rounded-lg border last:border-b"
          >
            <AccordionTrigger className="px-4 py-3 text-sm font-medium hover:no-underline">
              Tracing a request
            </AccordionTrigger>
            <AccordionContent className="space-y-3 px-4 pb-4">
              <p className="text-muted-foreground text-xs leading-relaxed">
                Every call is tagged with a correlation id that follows it through the whole
                platform. It is the single fastest way to get an answer about one specific request —
                without it, support is searching by timestamp.
              </p>
              <ol className="space-y-2.5">
                {[
                  "Send your own `X-Request-ID` if you already have a request or job id to tie this to. Omit it and one is generated for you.",
                  "You get it back in the `X-Request-ID` response header on every call, and again inside the body as `error.request_id` when the call fails — so an error alone is enough to trace, even if you did not capture the headers.",
                  "Log it next to your own identifiers. When something goes wrong days later, this is what turns a vague report into an exact lookup.",
                  "Quote it in support tickets. With the id we can pull the exact request; without it we cannot.",
                ].map((step, i) => (
                  <li key={i} className="flex gap-3">
                    <span className="bg-muted/40 text-muted-foreground flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[11px] font-semibold">
                      {i + 1}
                    </span>
                    <p className="text-muted-foreground text-xs leading-relaxed">{step}</p>
                  </li>
                ))}
              </ol>
              <CodeBlock
                code={buildCorrelationExample(apiBase)}
                title="Correlated request and its error response"
              />
              <div className="bg-muted/20 flex gap-3 rounded-lg border p-3">
                <Fingerprint className="text-muted-foreground size-4 shrink-0" />
                <p className="text-muted-foreground text-xs leading-relaxed">
                  Ids you send are capped at 128 characters and restricted to letters, digits, dot,
                  underscore and hyphen; anything else is stripped. Do not put personal data in them
                  — the id is written to logs.
                </p>
              </div>
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      </section>
    </div>
  );
}
