export async function GET() {
  return Response.json({
    ok: true,
    hasServerKey: !!process.env.GEMINI_API_KEY,
  });
}
