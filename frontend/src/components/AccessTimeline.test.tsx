/**
 * The timeline is SVG, not canvas, so unlike the map it can be asserted on
 * directly - that is the reason it is drawn with React elements and d3 scales
 * rather than by letting d3 append nodes itself.
 */
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { AccessTimeline } from './AccessTimeline';
import { satelliteColorScale } from '../lib/colors';
import { sampleAccess } from '../testFixtures';

const colors = satelliteColorScale(['STRIX-3', 'STRIX-5']);

function setup(overrides: Partial<React.ComponentProps<typeof AccessTimeline>> = {}) {
  const onHighlight = vi.fn();
  const onRangeChange = vi.fn();
  render(
    <AccessTimeline
      report={sampleAccess}
      colors={colors}
      highlighted={null}
      onHighlight={onHighlight}
      range={null}
      onRangeChange={onRangeChange}
      {...overrides}
    />,
  );
  return { onHighlight, onRangeChange };
}

/**
 * The legend chips and the timeline bars are both buttons naming a satellite -
 * the bars because a keyboard has to be able to reach them at all. So legend
 * assertions say which group they mean.
 */
const legend = () => within(screen.getByRole('group', { name: 'Satellites' }));

describe('AccessTimeline', () => {
  it('draws one bar per opportunity, coloured by satellite', () => {
    setup();
    const bars = screen.getAllByTestId('timeline-bar');
    expect(bars).toHaveLength(sampleAccess.windows.length);

    const strix5 = bars.find((b) => b.getAttribute('data-satellite') === 'STRIX-5');
    expect(strix5).toHaveAttribute('fill', colors.hex('STRIX-5'));
  });

  it('gives every bar a title naming its satellite, so identity is never colour alone', () => {
    setup();
    const bar = screen.getAllByTestId('timeline-bar')[0];
    expect(bar?.querySelector('title')?.textContent).toContain('STRIX-5');
    expect(bar?.querySelector('title')?.textContent).toContain('Jakarta, ID');
  });

  it('labels one row per target, in the order the backend returned them', () => {
    setup();
    // Each label is drawn once and carries a <title> with the same text, for the
    // phone case where the gutter cap truncates it - so match the drawn label.
    const labels = document.querySelectorAll('.timeline__row-label');
    expect([...labels].map((l) => l.firstChild?.textContent)).toEqual([
      'Mt. Aso, JP',
      'Jakarta, ID',
      // A window whose target the backend did not list still gets its own row.
      'Nowhere, XX',
    ]);
  });

  it('counts the opportunities and states the assumed steering envelope', () => {
    setup();
    expect(screen.getByText(/3 of 3 opportunities/)).toBeInTheDocument();
    expect(screen.getByText(/assumed/)).toBeInTheDocument();
  });

  it('says out loud that bar width is legibility, not duration', () => {
    setup();
    expect(screen.getByText(/legibility floor, not duration/)).toBeInTheDocument();
  });

  it('isolates a satellite when its legend chip is pressed', async () => {
    const { onHighlight } = setup();
    await userEvent.click(legend().getByRole('button', { name: /STRIX-3/ }));
    expect(onHighlight).toHaveBeenCalledWith('STRIX-3');
  });

  it('clears the isolation when the pressed chip is clicked again', async () => {
    const { onHighlight } = setup({ highlighted: 'STRIX-3' });
    const chip = legend().getByRole('button', { name: /STRIX-3/ });
    expect(chip).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(chip);
    expect(onHighlight).toHaveBeenCalledWith(null);
  });

  it('dims the other satellites instead of hiding them', () => {
    setup({ highlighted: 'STRIX-5' });
    const bars = screen.getAllByTestId('timeline-bar');
    expect(bars).toHaveLength(3);
    const dimmed = bars.find((b) => b.getAttribute('data-satellite') === 'STRIX-3');
    expect(dimmed).toHaveAttribute('opacity', '0.18');
  });

  it('highlights the satellite of a bar that is clicked', async () => {
    const { onHighlight } = setup();
    const bar = screen.getAllByTestId('timeline-bar')[0];
    await userEvent.click(bar!);
    expect(onHighlight).toHaveBeenCalledWith('STRIX-5');
  });

  it('shows the brushed range and offers a way out of it', async () => {
    const range = {
      from: new Date('2026-09-19T00:00:00Z'),
      to: new Date('2026-09-19T12:00:00Z'),
    };
    const { onRangeChange } = setup({ range });

    expect(screen.getByText(/1 of 3 opportunities/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Clear range' }));
    expect(onRangeChange).toHaveBeenCalledWith(null);
  });

  it('turns a drag across the chart into a time range', () => {
    const { onRangeChange } = setup();
    // jsdom reports a zero-origin bounding box, so clientX is the plot x plus
    // the left margin the chart reserves for row labels.
    const host = screen.getByText(/legibility floor/).parentElement!;

    fireEvent.pointerDown(host, { clientX: 96, pointerId: 1 });
    fireEvent.pointerMove(host, { clientX: 296, pointerId: 1 });
    fireEvent.pointerUp(host, { clientX: 296, pointerId: 1 });

    expect(onRangeChange).toHaveBeenCalledOnce();
    const range = onRangeChange.mock.calls[0]?.[0] as { from: Date; to: Date };
    expect(range.from.toISOString()).toBe(sampleAccess.horizon.startUtc.toISOString());
    expect(range.to.getTime()).toBeGreaterThan(range.from.getTime());
  });

  it('treats a tap as "clear the range", not as a one-pixel window', () => {
    const { onRangeChange } = setup();
    const host = screen.getByText(/legibility floor/).parentElement!;

    fireEvent.pointerDown(host, { clientX: 200, pointerId: 1 });
    fireEvent.pointerUp(host, { clientX: 201, pointerId: 1 });

    expect(onRangeChange).toHaveBeenCalledWith(null);
  });

  it('reaches a bar from the keyboard, because the map never can', async () => {
    const { onHighlight } = setup();

    // The chart is the first focusable thing in the panel, so one tab lands on
    // the first bar. Enter has to do what the click does.
    await userEvent.tab();
    expect(screen.getAllByTestId('timeline-bar')[0]).toHaveFocus();

    await userEvent.keyboard('{Enter}');
    expect(onHighlight).toHaveBeenCalledWith('STRIX-5');
  });

  it('keeps the bars in the accessibility tree instead of flattening the chart to an image', () => {
    setup();
    const chart = screen.getByRole('group', { name: /Access windows: 3 opportunities/ });
    // role="img" here would hide all three bars; role="group" keeps them.
    expect(within(chart).getAllByRole('button')).toHaveLength(3);
    expect(within(chart).getByRole('button', { name: /STRIX-5.*Jakarta, ID/ })).toBeInTheDocument();
  });

  it('widens the row-label gutter for a long target name instead of clipping it', () => {
    render(
      <AccessTimeline
        report={{
          ...sampleAccess,
          targets: [{ id: 'lyr', name: 'Longyearbyen, NO', latDeg: 78.2, lonDeg: 15.6 }],
        }}
        colors={colors}
        highlighted={null}
        onHighlight={vi.fn()}
        range={null}
        onRangeChange={vi.fn()}
      />,
    );

    // "Longyearbyen, NO" measures about 106px at 12px, so a fixed 96px gutter
    // clips it. The viewBox has to grow with the label.
    const svg = screen.getAllByRole('group', { name: /Access windows/ })[0]!;
    const translate = svg.querySelector('g')?.getAttribute('transform') ?? '';
    const gutter = Number(/translate\(([\d.]+)/.exec(translate)?.[1]);
    expect(gutter).toBeGreaterThan(96);
  });

  it('counts per satellite in the legend over the brushed range only', () => {
    setup({
      range: { from: new Date('2026-09-19T00:00:00Z'), to: new Date('2026-09-19T12:00:00Z') },
    });
    expect(legend().getByRole('button', { name: /STRIX-5 1/ })).toBeInTheDocument();
    expect(legend().getByRole('button', { name: /STRIX-3 0/ })).toBeInTheDocument();
  });
});
