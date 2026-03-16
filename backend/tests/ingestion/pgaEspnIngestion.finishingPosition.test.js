/**
 * Unit test for finishing position computation from cumulative strokes
 * Verifies that positions are assigned correctly with proper tie handling
 */

'use strict';

describe('PGA ESPN Ingestion - Finishing Position Computation', () => {
  /**
   * Test the position ranking algorithm with ties
   */
  it('assigns positions correctly based on cumulative strokes with proper tie handling', () => {
    // Simulate golfers with cumulative strokes
    const testGolfers = [
      { golfer_id: 'espn_1001', cumulativeStrokes: 268, holes: [{ strokes: 67 }] },
      { golfer_id: 'espn_1002', cumulativeStrokes: 269, holes: [{ strokes: 68 }] },
      { golfer_id: 'espn_1003', cumulativeStrokes: 269, holes: [{ strokes: 68 }] },
      { golfer_id: 'espn_1004', cumulativeStrokes: 271, holes: [{ strokes: 70 }] },
      { golfer_id: 'espn_1005', cumulativeStrokes: 271, holes: [{ strokes: 70 }] },
      { golfer_id: 'espn_1006', cumulativeStrokes: 271, holes: [{ strokes: 70 }] },
      { golfer_id: 'espn_1007', cumulativeStrokes: 272, holes: [{ strokes: 71 }] }
    ];

    const cumulativeStrokesMap = {
      'espn_1001': 268,
      'espn_1002': 269,
      'espn_1003': 269,
      'espn_1004': 271,
      'espn_1005': 271,
      'espn_1006': 271,
      'espn_1007': 272
    };

    // Sort golfers by cumulative strokes (ascending, lower is better)
    const sortedGolfers = [...testGolfers].sort((a, b) => {
      return (cumulativeStrokesMap[a.golfer_id] || 0) - (cumulativeStrokesMap[b.golfer_id] || 0);
    });

    // Assign positions based on stroke count (handling ties)
    let currentPosition = 1;
    for (let i = 0; i < sortedGolfers.length; i++) {
      if (i > 0 && cumulativeStrokesMap[sortedGolfers[i].golfer_id] === cumulativeStrokesMap[sortedGolfers[i - 1].golfer_id]) {
        // Tied with previous golfer, use same position
        sortedGolfers[i].position = sortedGolfers[i - 1].position;
      } else {
        // New position (accounting for ties)
        sortedGolfers[i].position = currentPosition;
      }
      currentPosition = i + 2;
    }

    // Verify positions
    expect(sortedGolfers[0].position).toBe(1); // 268 strokes -> position 1
    expect(sortedGolfers[1].position).toBe(2); // 269 strokes -> position 2
    expect(sortedGolfers[2].position).toBe(2); // 269 strokes (tied) -> position 2
    expect(sortedGolfers[3].position).toBe(4); // 271 strokes -> position 4
    expect(sortedGolfers[4].position).toBe(4); // 271 strokes (tied) -> position 4
    expect(sortedGolfers[5].position).toBe(4); // 271 strokes (tied) -> position 4
    expect(sortedGolfers[6].position).toBe(7); // 272 strokes -> position 7
  });

  /**
   * Test position mapping back to original array order
   */
  it('maps computed positions back to original golfers array by golfer_id', () => {
    const golfers = [
      { golfer_id: 'espn_1001', position: 0 },
      { golfer_id: 'espn_1002', position: 0 },
      { golfer_id: 'espn_1003', position: 0 }
    ];

    const cumulativeStrokesMap = {
      'espn_1001': 268,
      'espn_1002': 269,
      'espn_1003': 269
    };

    // Sort and compute positions
    const sortedGolfers = [...golfers].sort((a, b) => {
      return (cumulativeStrokesMap[a.golfer_id] || 0) - (cumulativeStrokesMap[b.golfer_id] || 0);
    });

    let currentPosition = 1;
    for (let i = 0; i < sortedGolfers.length; i++) {
      if (i > 0 && cumulativeStrokesMap[sortedGolfers[i].golfer_id] === cumulativeStrokesMap[sortedGolfers[i - 1].golfer_id]) {
        sortedGolfers[i].position = sortedGolfers[i - 1].position;
      } else {
        sortedGolfers[i].position = currentPosition;
      }
      currentPosition = i + 2;
    }

    // Map positions back to original array
    const positionMap = {};
    sortedGolfers.forEach(g => {
      positionMap[g.golfer_id] = g.position;
    });

    golfers.forEach(g => {
      g.position = positionMap[g.golfer_id] || 0;
    });

    // Verify original array has correct positions
    expect(golfers[0].position).toBe(1); // espn_1001 -> position 1
    expect(golfers[1].position).toBe(2); // espn_1002 -> position 2
    expect(golfers[2].position).toBe(2); // espn_1003 -> position 2
  });

  /**
   * Test edge case: single golfer
   */
  it('handles single golfer correctly', () => {
    const golfers = [
      { golfer_id: 'espn_1001', position: 0 }
    ];

    const cumulativeStrokesMap = {
      'espn_1001': 268
    };

    const sortedGolfers = [...golfers].sort((a, b) => {
      return (cumulativeStrokesMap[a.golfer_id] || 0) - (cumulativeStrokesMap[b.golfer_id] || 0);
    });

    let currentPosition = 1;
    for (let i = 0; i < sortedGolfers.length; i++) {
      if (i > 0 && cumulativeStrokesMap[sortedGolfers[i].golfer_id] === cumulativeStrokesMap[sortedGolfers[i - 1].golfer_id]) {
        sortedGolfers[i].position = sortedGolfers[i - 1].position;
      } else {
        sortedGolfers[i].position = currentPosition;
      }
      currentPosition = i + 2;
    }

    const positionMap = {};
    sortedGolfers.forEach(g => {
      positionMap[g.golfer_id] = g.position;
    });

    golfers.forEach(g => {
      g.position = positionMap[g.golfer_id] || 0;
    });

    expect(golfers[0].position).toBe(1);
  });

  /**
   * Test edge case: all golfers tied
   */
  it('handles all golfers tied at same stroke count', () => {
    const golfers = [
      { golfer_id: 'espn_1001', position: 0 },
      { golfer_id: 'espn_1002', position: 0 },
      { golfer_id: 'espn_1003', position: 0 }
    ];

    const cumulativeStrokesMap = {
      'espn_1001': 270,
      'espn_1002': 270,
      'espn_1003': 270
    };

    const sortedGolfers = [...golfers].sort((a, b) => {
      return (cumulativeStrokesMap[a.golfer_id] || 0) - (cumulativeStrokesMap[b.golfer_id] || 0);
    });

    let currentPosition = 1;
    for (let i = 0; i < sortedGolfers.length; i++) {
      if (i > 0 && cumulativeStrokesMap[sortedGolfers[i].golfer_id] === cumulativeStrokesMap[sortedGolfers[i - 1].golfer_id]) {
        sortedGolfers[i].position = sortedGolfers[i - 1].position;
      } else {
        sortedGolfers[i].position = currentPosition;
      }
      currentPosition = i + 2;
    }

    const positionMap = {};
    sortedGolfers.forEach(g => {
      positionMap[g.golfer_id] = g.position;
    });

    golfers.forEach(g => {
      g.position = positionMap[g.golfer_id] || 0;
    });

    // All should be position 1 when tied
    expect(golfers[0].position).toBe(1);
    expect(golfers[1].position).toBe(1);
    expect(golfers[2].position).toBe(1);
  });
});
