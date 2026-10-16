import { withApiErrors } from '@/server/auth/api-response';
import {
  checkMeasurementOrigin,
  measurementErrorResponse,
  retryMeasurementSync,
} from '@/server/measurements';
async function POSTHandler(
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

export const POST = withApiErrors(POSTHandler);
