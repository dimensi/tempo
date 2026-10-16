import { withApiErrors } from '@/server/auth/api-response';
import {
  checkMeasurementOrigin,
  listMeasurements,
  measurementErrorResponse,
  saveMeasurement,
} from '@/server/measurements';
async function GETHandler(request: Request) {
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
async function POSTHandler(request: Request) {
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

export const GET = withApiErrors(GETHandler);

export const POST = withApiErrors(POSTHandler);
