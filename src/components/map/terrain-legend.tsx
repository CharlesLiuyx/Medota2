export function TerrainLegend({ layer }: { layer: string }) {
  if (layer !== "navigation" && layer !== "height" && layer !== "currents")
    return null;
  const navigation = layer === "navigation";
  const rows = navigation
    ? [
        [
          "#4bbe8e",
          "绿 · 可通行标记",
          "静态导航格标记，不含树木、单位等动态阻挡。",
        ],
        [
          "#e25bb7",
          "紫 · 禁止插眼",
          "插眼限制；是否能走仍取决于该格的通行标记，不代表全部不可走。",
        ],
        ["#4b556e", "灰 · 无通行标记", "陆地寻路按阻挡处理。"],
        [
          "#f5b441",
          "黄 · 含未知标记",
          "尚未确认全部含义，陆地寻路保守视为阻挡。",
        ],
      ]
    : layer === "height"
      ? [
          ["#3484da", "蓝 · Z < 64", ""],
          ["#58aa48", "绿 · 64 ≤ Z < 192", ""],
          ["#cec248", "黄 · 192 ≤ Z < 320", ""],
          ["#e49038", "橙 · 320 ≤ Z < 448", ""],
          ["#d6543e", "红 · 448 ≤ Z < 576", ""],
          ["#b056b0", "紫 · 576 ≤ Z < 704", ""],
          ["#b4becd", "浅灰 · Z ≥ 704", ""],
        ]
      : [
          [
            "#64e5ec",
            "青色网格 · 湍流区域",
            "由此版本原生路径节点与半径重建，填满对齐的 64 单位导航格，与寻路共用格心判定及树木阻挡；箭头表示顺流方向。",
          ],
        ];
  return (
    <section
      aria-label="地形图例"
      className="mt-3 rounded bg-white/[0.035] p-3 text-xs leading-5"
    >
      <h2 className="mb-2 font-semibold">
        {navigation
          ? "导航栅格"
          : layer === "height"
            ? "地面高度 · Z 轴"
            : "湍流区域与方向"}
      </h2>
      <ul className="space-y-2">
        {rows.map(([color, label, note]) => (
          <li key={label}>
            <div className="flex items-center gap-2">
              <span
                aria-hidden
                className="size-3 shrink-0 rounded-sm"
                style={{ background: color }}
              />
              <span>{label}</span>
            </div>
            {note && <p className="ml-5 text-[var(--text-muted)]">{note}</p>}
          </li>
        ))}
      </ul>
      <p className="mt-3 text-[var(--text-muted)]">
        {navigation
          ? "每格 64 游戏单位。叠色为半透明，底图会影响观感；树木绿色方块是额外阻挡层。禁插眼颜色优先于通行颜色。"
          : layer === "height"
            ? "数值为世界 Z 轴游戏单位，每 128 单位一个色阶；蓝色和浅灰色含两端超出范围的高度。透明处无有效样本。按 32 单位采样显示，不代表全部为 32 单位精度，也不等同于可通行性。"
            : "顺流最大 +150 移速，逆流不减速。方向增益以正向投影估算，曲线宽度线性插值；边界和斜向效果尚未经游戏引擎验证。"}
      </p>
      <p className="mt-2 text-[10px] text-[var(--text-muted)]">
        来自当前地图版本。导航及高度采用社区解码，尚需同版本引擎抽样核对。
      </p>
    </section>
  );
}
