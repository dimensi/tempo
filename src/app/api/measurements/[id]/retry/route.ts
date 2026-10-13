import {
  checkMeasurementOrigin,
  retryMeasurementSync,
  measurementErrorResponse,
} from '@/server/measurements';
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    checkMeasurementOrigin(request);
    return Response.json(
      await retryMeasurementSync(
        request.headers,
        new URL(request.url).searchParams.get('ownerId') ?? '',
        (await context.params).id,
      ),
    );
  } catch (error) {
    return measurementErrorResponse(error);
  }
}
