
const {
  ACTORS,
  TransitionNotAllowedError,
  assertAllowedDbStatusTransition,
} = require('../../services/helpers/contestTransitionValidator');

describe('contestTransitionValidator', () => {
  describe('Allowed Transitions', () => {
    // ORGANIZER
    test('ORGANIZER: SCHEDULED -> LOCKED should be allowed', () => {
      expect(assertAllowedDbStatusTransition({ fromStatus: 'SCHEDULED', toStatus: 'LOCKED', actor: ACTORS.ORGANIZER })).toBe(true);
    });

    test('ORGANIZER: SCHEDULED -> CANCELLED should be allowed', () => {
      expect(assertAllowedDbStatusTransition({ fromStatus: 'SCHEDULED', toStatus: 'CANCELLED', actor: ACTORS.ORGANIZER })).toBe(true);
    });

    // SYSTEM
    test('SYSTEM: LOCKED -> LIVE should be allowed', () => {
      expect(assertAllowedDbStatusTransition({ fromStatus: 'LOCKED', toStatus: 'LIVE', actor: ACTORS.SYSTEM })).toBe(true);
    });

    test('SYSTEM: LIVE -> COMPLETE should be allowed', () => {
      expect(assertAllowedDbStatusTransition({ fromStatus: 'LIVE', toStatus: 'COMPLETE', actor: ACTORS.SYSTEM })).toBe(true);
    });

    test('SYSTEM: LIVE -> ERROR should be allowed', () => {
      expect(assertAllowedDbStatusTransition({ fromStatus: 'LIVE', toStatus: 'ERROR', actor: ACTORS.SYSTEM })).toBe(true);
    });

    // ADMIN
    test('ADMIN: ERROR -> COMPLETE should be allowed', () => {
      expect(assertAllowedDbStatusTransition({ fromStatus: 'ERROR', toStatus: 'COMPLETE', actor: ACTORS.ADMIN })).toBe(true);
    });

    test('ADMIN: ERROR -> CANCELLED should be allowed', () => {
      expect(assertAllowedDbStatusTransition({ fromStatus: 'ERROR', toStatus: 'CANCELLED', actor: ACTORS.ADMIN })).toBe(true);
    });
  });

  describe('Disallowed Transitions', () => {
    // ORGANIZER
    test('ORGANIZER: LOCKED -> SCHEDULED should throw', () => {
      expect(() => assertAllowedDbStatusTransition({ fromStatus: 'LOCKED', toStatus: 'SCHEDULED', actor: ACTORS.ORGANIZER }))
        .toThrow("Transition from 'LOCKED' to 'SCHEDULED' is not allowed for ORGANIZER");
    });

    // SYSTEM
    test('SYSTEM: SCHEDULED -> LIVE should throw', () => {
      expect(() => assertAllowedDbStatusTransition({ fromStatus: 'SCHEDULED', toStatus: 'LIVE', actor: ACTORS.SYSTEM }))
        .toThrow("Transition from 'SCHEDULED' to 'LIVE' is not allowed for SYSTEM");
    });

    // ADMIN
    test('ADMIN: COMPLETE -> SCHEDULED should throw', () => {
      expect(() => assertAllowedDbStatusTransition({ fromStatus: 'COMPLETE', toStatus: 'SCHEDULED', actor: ACTORS.ADMIN }))
        .toThrow("Transition from terminal state 'COMPLETE' is not allowed for ADMIN");
    });
  });

  describe('Terminal State Protection', () => {
    test('Transition from COMPLETE should always throw', () => {
      const statuses = ['SCHEDULED', 'LOCKED', 'LIVE', 'CANCELLED', 'ERROR'];
      statuses.forEach(toStatus => {
        expect(() => assertAllowedDbStatusTransition({ fromStatus: 'COMPLETE', toStatus, actor: ACTORS.ORGANIZER }))
          .toThrow(TransitionNotAllowedError);
      });
    });

    test('Transition from CANCELLED should always throw', () => {
      const statuses = ['SCHEDULED', 'LOCKED', 'LIVE', 'COMPLETE', 'ERROR'];
      statuses.forEach(toStatus => {
        expect(() => assertAllowedDbStatusTransition({ fromStatus: 'CANCELLED', toStatus, actor: ACTORS.ADMIN }))
          .toThrow(TransitionNotAllowedError);
      });
    });

    test('Non-ADMIN transition from ERROR should throw', () => {
      const actors = [ACTORS.ORGANIZER, ACTORS.SYSTEM];
      actors.forEach(actor => {
        expect(() => assertAllowedDbStatusTransition({ fromStatus: 'ERROR', toStatus: 'COMPLETE', actor }))
          .toThrow(`Transition from 'ERROR' to 'COMPLETE' is not allowed for ${actor}`);
      });
    });
  });

  describe('Invalid Inputs', () => {
    test('Should throw for unknown actor', () => {
      expect(() => assertAllowedDbStatusTransition({ fromStatus: 'SCHEDULED', toStatus: 'LOCKED', actor: 'UNKNOWN_ACTOR' }))
        .toThrow("Transition from 'SCHEDULED' to 'LOCKED' is not allowed for UNKNOWN_ACTOR");
    });

    test('Should throw for invalid fromStatus', () => {
      expect(() => assertAllowedDbStatusTransition({ fromStatus: 'invalid', toStatus: 'LOCKED', actor: ACTORS.ORGANIZER }))
        .toThrow("Transition from 'invalid' to 'LOCKED' is not allowed for ORGANIZER");
    });

    test('Should throw for invalid toStatus', () => {
      expect(() => assertAllowedDbStatusTransition({ fromStatus: 'SCHEDULED', toStatus: 'invalid', actor: ACTORS.ORGANIZER }))
        .toThrow("Transition from 'SCHEDULED' to 'invalid' is not allowed for ORGANIZER");
    });
  });
});
