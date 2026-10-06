import Link from "next/link";
export default function UnitNotFound() {
  return (
    <main className="px-6 py-16">
      <h1 className="text-xl">未找到该单位</h1>
      <Link href="/units" className="mt-4 block text-sm">
        返回单位图鉴
      </Link>
    </main>
  );
}
