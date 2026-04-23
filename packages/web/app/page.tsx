// packages/web/app/page.tsx
import Link from 'next/link';

export default function Home() {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center p-8">
      <div className="text-center">
        <h1 className="text-4xl font-bold mb-4">QBot Assistant</h1>
        <p className="text-gray-600 mb-8">Super Personal Assistant</p>
        <div className="flex gap-4">
          <Link
            href="/chat"
            className="px-6 py-3 bg-primary-600 text-white rounded-lg hover:bg-primary-700"
          >
            Start Chat
          </Link>
          <Link
            href="/login"
            className="px-6 py-3 border rounded-lg hover:bg-gray-50"
          >
            Login
          </Link>
        </div>
      </div>
    </main>
  );
}
