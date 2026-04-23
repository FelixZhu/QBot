import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  try {
    const { username, password } = await request.json();

    // 简单的虚假登录验证
    if (username === 'admin' && password === 'admin') {
      return NextResponse.json({
        success: true,
        user: {
          id: '1',
          username: 'admin',
          name: 'Admin User',
          email: 'admin@qbot.local'
        }
      });
    }

    return NextResponse.json(
      { error: 'Invalid username or password' },
      { status: 401 }
    );
  } catch {
    return NextResponse.json(
      { error: 'Login failed' },
      { status: 500 }
    );
  }
}
