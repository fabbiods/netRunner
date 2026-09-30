import { ApplicationError } from '../errors.mjs';

const MAX_EDIT_DISTANCE = 4000;

function valueAt(map, key) {
  return map.get(key) ?? Number.NEGATIVE_INFINITY;
}

function backtrack(trace, left, right) {
  let leftIndex = left.length;
  let rightIndex = right.length;
  const rows = [];

  for (let distance = trace.length - 1; distance >= 0; distance -= 1) {
    const diagonal = leftIndex - rightIndex;
    const frontier = trace[distance];
    const previousDiagonal =
      diagonal === -distance ||
      (diagonal !== distance && valueAt(frontier, diagonal - 1) < valueAt(frontier, diagonal + 1))
        ? diagonal + 1
        : diagonal - 1;
    const previousLeft = Math.max(0, valueAt(frontier, previousDiagonal));
    const previousRight = previousLeft - previousDiagonal;

    while (leftIndex > previousLeft && rightIndex > previousRight) {
      rows.push({
        kind: 'equal',
        leftNumber: leftIndex,
        rightNumber: rightIndex,
        text: left[leftIndex - 1],
      });
      leftIndex -= 1;
      rightIndex -= 1;
    }
    if (distance === 0) break;
    if (leftIndex === previousLeft) {
      rows.push({
        kind: 'added',
        leftNumber: null,
        rightNumber: rightIndex,
        text: right[rightIndex - 1],
      });
      rightIndex -= 1;
    } else {
      rows.push({
        kind: 'removed',
        leftNumber: leftIndex,
        rightNumber: null,
        text: left[leftIndex - 1],
      });
      leftIndex -= 1;
    }
  }
  return rows.reverse();
}

export function diffLines(left, right) {
  const maximum = left.length + right.length;
  let frontier = new Map([[1, 0]]);
  const trace = [];

  for (let distance = 0; distance <= maximum; distance += 1) {
    if (distance > MAX_EDIT_DISTANCE) {
      throw new ApplicationError('As configurações são diferentes demais para uma comparação segura.', {
        code: 'diff_too_complex',
        statusCode: 422,
      });
    }
    trace.push(new Map(frontier));
    for (let diagonal = -distance; diagonal <= distance; diagonal += 2) {
      let leftIndex;
      if (
        diagonal === -distance ||
        (diagonal !== distance && valueAt(frontier, diagonal - 1) < valueAt(frontier, diagonal + 1))
      ) {
        leftIndex = Math.max(0, valueAt(frontier, diagonal + 1));
      } else {
        leftIndex = Math.max(0, valueAt(frontier, diagonal - 1)) + 1;
      }
      let rightIndex = leftIndex - diagonal;
      while (
        leftIndex < left.length &&
        rightIndex < right.length &&
        left[leftIndex] === right[rightIndex]
      ) {
        leftIndex += 1;
        rightIndex += 1;
      }
      frontier.set(diagonal, leftIndex);
      if (leftIndex >= left.length && rightIndex >= right.length) {
        return backtrack(trace, left, right);
      }
    }
  }
  return [];
}
