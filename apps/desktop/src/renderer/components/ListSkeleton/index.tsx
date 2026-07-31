import { Skeleton } from "antd";

export default function ListSkeleton() {
  return (
    <div className="grid gap-2 px-2 py-1">
      {[1, 2, 3, 4].map((item) => (
        <div key={item} className="flex items-center gap-3 py-2">
          <Skeleton.Avatar active shape="square" size={40} />
          <Skeleton active title={{ width: "48%" }} paragraph={{ rows: 1, width: "82%" }} />
        </div>
      ))}
    </div>
  );
}
