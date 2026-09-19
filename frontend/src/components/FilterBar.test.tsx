import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { FilterBar } from './FilterBar';
import { NO_FILTERS, filterOptions } from '../lib/filters';
import { sampleScenes } from '../testFixtures';

const options = filterOptions(sampleScenes);

function setup(overrides: Partial<React.ComponentProps<typeof FilterBar>> = {}) {
  const onChange = vi.fn();
  render(
    <FilterBar
      options={options}
      filters={NO_FILTERS}
      onChange={onChange}
      matching={2}
      total={2}
      {...overrides}
    />,
  );
  return { onChange };
}

describe('FilterBar', () => {
  it('offers the four filters the planning workflow needs', () => {
    setup();
    expect(screen.getByLabelText('Satellite')).toBeInTheDocument();
    expect(screen.getByLabelText('Imaging mode')).toBeInTheDocument();
    expect(screen.getByLabelText('Pass direction')).toBeInTheDocument();
    expect(screen.getByLabelText('Look side')).toBeInTheDocument();
  });

  it('builds its options from the catalog', () => {
    setup();
    const select = screen.getByLabelText('Imaging mode');
    expect(select).toHaveDisplayValue('All modes');
    expect(screen.getByRole('option', { name: 'Sliding Spotlight' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Stripmap' })).toBeInTheDocument();
  });

  it('reports a chosen value to the parent', async () => {
    const { onChange } = setup();
    await userEvent.selectOptions(screen.getByLabelText('Satellite'), 'STRIX-5');
    expect(onChange).toHaveBeenCalledWith({ ...NO_FILTERS, satellite: 'STRIX-5' });
  });

  it('reports null, not an empty string, when a filter is cleared', async () => {
    const { onChange } = setup({ filters: { ...NO_FILTERS, satellite: 'STRIX-5' } });
    await userEvent.selectOptions(screen.getByLabelText('Satellite'), '');
    expect(onChange).toHaveBeenCalledWith(NO_FILTERS);
  });

  it('disables reset when nothing is filtered and counts the active ones when there is', () => {
    const { onChange } = setup();
    expect(screen.getByRole('button', { name: 'Reset' })).toBeDisabled();
    onChange.mockClear();

    render(
      <FilterBar
        options={options}
        filters={{ ...NO_FILTERS, satellite: 'STRIX-3', lookSide: 'Left' }}
        onChange={onChange}
        matching={1}
        total={2}
      />,
    );
    expect(screen.getByRole('button', { name: 'Reset (2)' })).toBeEnabled();
  });

  it('shows how much of the catalog survived the filters', () => {
    setup({ matching: 1, total: 2 });
    expect(screen.getByText('1 of 2 scenes')).toBeInTheDocument();
  });

  it('explains an empty result instead of leaving a blank panel', () => {
    setup({ matching: 0, total: 2 });
    expect(screen.getByText(/No scene matches these four filters/)).toBeInTheDocument();
  });
});
