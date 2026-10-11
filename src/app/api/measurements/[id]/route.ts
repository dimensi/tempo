import {
  saveMeasurement,
  deleteMeasurement,
  measurementErrorResponse,
  checkMeasurementOrigin,
} from '@/server/measurements';
type Context = { params: Promise<{ id: string }> };
export async function PUT(request: Request, context: Context) {
  try {
    checkMeasurementOrigin(request);
    return Response.json(
      await saveMeasurement(
        request.headers,
        new URL(request.url).searchParams.get('ownerId') ?? '',
        await request.json(),
        (await context.params).id,
      ),
    );
  } catch (error) {
    return measurementErrorResponse(error);
  }
}
export async function DELETE(request: Request, context: Context) {
  try {
    checkMeasurementOrigin(request);
    await deleteMeasurement(
      request.headers,
      new URL(request.url).searchParams.get('ownerId') ?? '',
      (await context.params).id,
    );
    return new Response(null, { status: 204 });
  } catch (error) {
    return measurementErrorResponse(error);
  }
}
