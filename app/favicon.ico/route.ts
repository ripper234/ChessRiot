export function GET(request: Request) {
  return Response.redirect(new URL("/icons/chessriot-192.png", request.url), 308);
}
