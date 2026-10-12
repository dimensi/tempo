import { offlinePhoto } from '@/server/offline';
import {
  offlineResponseError,
  offlineResponseHeaders,
} from '@/server/offline/errors';
export async function GET(
  request: Request,
  context: { params: Promise<{ opaque: string }> },
) {
  try {
    const { opaque } = await context.params;
    const { bytes, contentType } = await offlinePhoto(
      request.headers,
      new URL(request.url),
      opaque,
    );
    return new Response(new Uint8Array(bytes), {
      headers: {
        ...offlineResponseHeaders,
        'Content-Type': contentType,
        'Content-Disposition': 'inline',
        'Content-Security-Policy': "default-src 'none'",
      },
    });
  } catch (error) {
    return offlineResponseError(error);
  }
}
