import { NextResponse, type NextRequest } from 'next/server';
import { exerciseReturnTo } from '@/lib/exercise-link';

export function proxy(request: NextRequest) {
  const headers = new Headers(request.headers);
  headers.set(
    'x-tempo-exercise-return-to',
    exerciseReturnTo(request.nextUrl.pathname) ?? '',
  );
  return NextResponse.next({ request: { headers } });
}

export const config = { matcher: '/workouts/catalog/:id' };
