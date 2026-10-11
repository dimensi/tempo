import {
  listMeasurements,
  saveMeasurement,
  measurementErrorResponse,
  checkMeasurementOrigin,
} from '@/server/measurements';
export async function GET(request: Request) {
  try {
    return Response.json(
      await listMeasurements(
        request.headers,
        new URL(request.url).searchParams.get('ownerId') ?? '',
      ),
    );
  } catch (error) {
    return measurementErrorResponse(error);
  }
}
export async function POST(request: Request) {
  try {
    checkMeasurementOrigin(request);
    return Response.json(
      await saveMeasurement(
        request.headers,
        new URL(request.url).searchParams.get('ownerId') ?? '',
        await request.json(),
      ),
      { status: 201 },
    );
  } catch (error) {
    return measurementErrorResponse(error);
  }
}
