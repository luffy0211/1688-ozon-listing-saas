import { NextResponse } from "next/server";

/** 统一成功响应：{ "data": {} } */
export function ok<T>(data: T, status = 200): NextResponse {
  return NextResponse.json({ data }, { status });
}

/** 统一错误响应：{ "error": { code, message, details } } */
export function fail(
  code: string,
  message: string,
  details: unknown[] = [],
  status = 400,
): NextResponse {
  return NextResponse.json(
    { error: { code, message, details } },
    { status },
  );
}

export function unauthorized(): NextResponse {
  return fail("unauthorized", "未登录或会话已过期", [], 401);
}

export function forbidden(): NextResponse {
  return fail("forbidden", "没有权限执行该操作", [], 403);
}

export function notFound(message = "资源不存在"): NextResponse {
  return fail("not_found", message, [], 404);
}
