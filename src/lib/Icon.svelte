<script module lang="ts">
  // RepoTray geometry constructed from basic SVG primitives; see docs/ASSETS.md.
  type Shape = {
    tag: 'line' | 'polyline' | 'rect' | 'circle' | 'path';
    attributes: Record<string, number | string>;
  };
  const line = (x1: number, y1: number, x2: number, y2: number): Shape => ({
    tag: 'line',
    attributes: { x1, y1, x2, y2 },
  });
  const wire = (points: string): Shape => ({
    tag: 'polyline',
    attributes: { points },
  });
  const ring = (cx: number, cy: number, r: number): Shape => ({
    tag: 'circle',
    attributes: { cx, cy, r },
  });
  const box = (
    x: number,
    y: number,
    width: number,
    height: number,
    rx = 2,
  ): Shape => ({ tag: 'rect', attributes: { x, y, width, height, rx } });

  const glyphs = {
    heart: [
      {
        tag: 'path',
        attributes: {
          d: 'M20.8 4.8a5.4 5.4 0 0 0-7.6 0L12 6l-1.2-1.2a5.4 5.4 0 0 0-7.6 7.6L12 21l8.8-8.6a5.4 5.4 0 0 0 0-7.6Z',
        },
      },
    ],
    tray: [
      box(3.5, 5, 17, 15, 2.5),
      wire('3.5,13 8,13 10,16 14,16 16,13 20.5,13'),
      line(8, 9, 16, 9),
    ],
    activity: [wire('3,13 7.5,13 10,6 13.5,18 16,10 18,13 21,13')],
    play: [wire('8,5 19,12 8,19 8,5')],
    search: [ring(10, 10, 6), line(14.5, 14.5, 20, 20)],
    settings: [
      ring(12, 12, 3),
      ring(12, 12, 7),
      line(12, 2, 12, 5),
      line(12, 19, 12, 22),
      line(2, 12, 5, 12),
      line(19, 12, 22, 12),
      line(5, 5, 7, 7),
      line(17, 17, 19, 19),
      line(5, 19, 7, 17),
      line(17, 7, 19, 5),
    ],
    chevron: [wire('8,5 15,12 8,19')],
    down: [wire('5,8 12,15 19,8')],
    refresh: [
      wire('19,8 16,5 10,4 5,7 3,12 5,17 10,20 16,19 20,15'),
      wire('19,3 19,8 14,8'),
    ],
    branch: [
      line(7, 6, 7, 18),
      wire('7,12 17,12 17,6'),
      ring(7, 4, 2),
      ring(7, 20, 2),
      ring(17, 4, 2),
    ],
    check: [wire('4,12 9.5,17.5 20,7')],
    close: [line(5.5, 5.5, 18.5, 18.5), line(18.5, 5.5, 5.5, 18.5)],
    clock: [ring(12, 12, 8.5), wire('12,7.5 12,12 16,14')],
    pause: [box(7, 5, 3, 14, 1), box(14, 5, 3, 14, 1)],
    repo: [
      box(5, 3, 14, 18),
      line(5, 16, 19, 16),
      line(9, 7, 15, 7),
      line(9, 10.5, 13, 10.5),
    ],
    pin: [
      wire('8,4 16,4 15,9 18,12 18,14 6,14 6,12 9,9 8,4'),
      line(12, 14, 12, 21),
    ],
    plus: [line(12, 4, 12, 20), line(4, 12, 20, 12)],
    external: [
      box(3.5, 8.5, 12, 12),
      wire('13,3.5 20.5,3.5 20.5,11'),
      line(20.5, 3.5, 10, 14),
    ],
    warning: [
      wire('12,3.5 21,20 3,20 12,3.5'),
      line(12, 8, 12, 13),
      line(12, 16.5, 12, 17),
    ],
    shield: [
      wire('12,3 20,6 19,13 16,18 12,21 8,18 5,13 4,6 12,3'),
      wire('9,12 11.5,14.5 16,9.5'),
    ],
    // Generic code-hosting symbol; the surrounding label names the service.
    github: [
      box(3.5, 4.5, 17, 15, 3),
      wire('9,9 6,12 9,15'),
      wire('15,9 18,12 15,15'),
    ],
    computer: [
      box(3.5, 4, 17, 12),
      line(12, 16, 12, 20),
      line(8, 20, 16, 20),
      wire('8,8 10,10 8,12'),
      line(13, 12, 16, 12),
    ],
    trash: [
      box(6, 7, 12, 14),
      line(4, 7, 20, 7),
      wire('9,7 9,3 15,3 15,7'),
      line(10, 11, 10, 17),
      line(14, 11, 14, 17),
    ],
    bolt: [wire('14,3 5,13 11,13 10,21 19,10 13,10 14,3')],
    arrow: [line(4, 12, 20, 12), wire('14,6 20,12 14,18')],
    // Two corner arrows pointing out (fill the panel) or in (back to the overview).
    maximize: [
      wire('14,4 20,4 20,10'),
      line(20, 4, 13.5, 10.5),
      wire('10,20 4,20 4,14'),
      line(4, 20, 10.5, 13.5),
    ],
    minimize: [
      wire('14,4 14,10 20,10'),
      line(14, 10, 20.5, 3.5),
      wire('10,20 10,14 4,14'),
      line(10, 14, 3.5, 20.5),
    ],
    copy: [
      box(8.5, 8.5, 12, 12),
      {
        tag: 'path',
        attributes: {
          d: 'M15.5 8.5v-3a2 2 0 0 0-2-2h-8a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h3',
        },
      },
    ],
    info: [ring(12, 12, 8.5), line(12, 11, 12, 16), line(12, 8, 12, 8.01)],
    userPlus: [
      ring(10, 8, 4),
      wire('3.5,20 4.5,17 7,15 13,15 15.5,17 16.5,20'),
      line(19, 8, 19, 14),
      line(16, 11, 22, 11),
    ],
  } satisfies Record<string, Shape[]>;

  /** Every glyph name; a typo at a call site is a type error, not a silent fallback. */
  export type IconName = keyof typeof glyphs;
</script>

<script lang="ts">
  let {
    name,
    size = 18,
    class: className = '',
  }: { name: IconName; size?: number; class?: string } = $props();
</script>

<svg
  width={size}
  height={size}
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="1.6"
  stroke-linecap="round"
  stroke-linejoin="round"
  class={className}
  aria-hidden="true"
>
  {#each glyphs[name] ?? glyphs.repo as shape, index (index)}
    <svelte:element this={shape.tag} {...shape.attributes} />
  {/each}
</svg>
