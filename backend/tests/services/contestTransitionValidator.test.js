
const {
  ACTORS,
  TransitionNotAllowedError,
  assertAllowedDbStatusTransition,
} = require('../../services/helpers/contestTransitionValidator');

describe('contestTransitionValidator', () => {
  // Test cases for allowed transitions
  describe('Allowed Transitions', () => {
    // ORGANIZER
    test('ORGANIZER: draft -> open should be allowed', () => {
      expect(assertAllowedDbStatusTransition({ fromStatus: 'draft', toStatus: 'open', actor: ACTORS.ORGANIZER })).toBe(true);
    });

    test('ORGANIZER: draft -> cancelled should be allowed', () => {
      expect(assertAllowedDbStatusTransition({ fromStatus: 'draft', toStatus: 'cancelled', actor: ACTORS.ORGANIZER })).toBe(true);
    });

    test('ORGANIZER: open -> locked should be allowed', () => {
      expect(assertAllowedDbStatusTransition({ fromStatus: 'open', toStatus: 'locked', actor: ACTORS.ORGANIZER })).toBe(true);
    });

    test('ORGANIZER: open -> cancelled should be allowed', () => {
      expect(assertAllowedDbStatusTransition({ fromStatus: 'open', toStatus: 'cancelled', actor: ACTORS.ORGANIZER })).toBe(true);
    });

    // ADMIN
    test('ADMIN: draft -> open should be allowed', () => {
      expect(assertAllowedDbStatusTransition({ fromStatus: 'draft', toStatus: 'open', actor: ACTORS.ADMIN })).toBe(true);
    });

    test('ADMIN: draft -> cancelled should be allowed', () => {
      expect(assertAllowedDbStatusTransition({ fromStatus: 'draft', toStatus: 'cancelled', actor: ACTORS.ADMIN })).toBe(true);
    });

    test('ADMIN: open -> cancelled should be allowed', () => {
      expect(assertAllowedDbStatusTransition({ fromStatus: 'open', toStatus: 'cancelled', actor: ACTORS.ADMIN })).toBe(true);
    });

    test('ADMIN: locked -> cancelled should be allowed', () => {
      expect(assertAllowedDbStatusTransition({ fromStatus: 'locked', toStatus: 'cancelled', actor: ACTORS.ADMIN })).toBe(true);
    });

    // ADMIN special rule: open -> draft
    test('ADMIN: open -> draft should be allowed if context.hasOnlyOrganizerParticipant is true', () => {
      expect(assertAllowedDbStatusTransition({
        fromStatus: 'open',
        toStatus: 'draft',
        actor: ACTORS.ADMIN,
        context: { hasOnlyOrganizerParticipant: true },
      })).toBe(true);
    });

    // SYSTEM
    test('SYSTEM: open -> locked should be allowed', () => {
      expect(assertAllowedDbStatusTransition({ fromStatus: 'open', toStatus: 'locked', actor: ACTORS.SYSTEM })).toBe(true);
    });

    test('SYSTEM: locked -> settled should be allowed', () => {
      expect(assertAllowedDbStatusTransition({ fromStatus: 'locked', toStatus: 'settled', actor: ACTORS.SYSTEM })).toBe(true);
    });
  });

  // Test cases for disallowed transitions
  describe('Disallowed Transitions', () => {
    // ORGANIZER
    test('ORGANIZER: open -> draft should throw TransitionNotAllowedError', () => {
      expect(() => assertAllowedDbStatusTransition({ fromStatus: 'open', toStatus: 'draft', actor: ACTORS.ORGANIZER }))
        .toThrow(TransitionNotAllowedError);
      expect(() => assertAllowedDbStatusTransition({ fromStatus: 'open', toStatus: 'draft', actor: ACTORS.ORGANIZER }))
        .toThrow("Transition from 'open' to 'draft' is not allowed for ORGANIZER");
    });

    test('ORGANIZER: locked -> open should throw TransitionNotAllowedError', () => {
      expect(() => assertAllowedDbStatusTransition({ fromStatus: 'locked', toStatus: 'open', actor: ACTORS.ORGANIZER }))
        .toThrow(TransitionNotAllowedError);
      expect(() => assertAllowedDbStatusTransition({ fromStatus: 'locked', toStatus: 'open', actor: ACTORS.ORGANIZER }))
        .toThrow("Transition from 'locked' to 'open' is not allowed for ORGANIZER");
    });

    // ADMIN
    test('ADMIN: open -> draft should throw if context.hasOnlyOrganizerParticipant is false', () => {
      expect(() => assertAllowedDbStatusTransition({
        fromStatus: 'open',
        toStatus: 'draft',
        actor: ACTORS.ADMIN,
        context: { hasOnlyOrganizerParticipant: false },
      })).toThrow(TransitionNotAllowedError);
      expect(() => assertAllowedDbStatusTransition({
        fromStatus: 'open',
        toStatus: 'draft',
        actor: ACTORS.ADMIN,
        context: { hasOnlyOrganizerParticipant: false },
      })).toThrow("Transition from 'open' to 'draft' is not allowed for ADMIN: Contest must have only the organizer as a participant");
    });

    test('ADMIN: open -> draft should throw if context.hasOnlyOrganizerParticipant is not present', () => {
      expect(() => assertAllowedDbStatusTransition({
        fromStatus: 'open',
        toStatus: 'draft',
        actor: ACTORS.ADMIN,
        context: {},
      })).toThrow(TransitionNotAllowedError);
      expect(() => assertAllowedDbStatusTransition({
        fromStatus: 'open',
        toStatus: 'draft',
        actor: ACTORS.ADMIN,
        context: {},
      })).toThrow("Transition from 'open' to 'draft' is not allowed for ADMIN: Contest must have only the organizer as a participant");
    });

    test('ADMIN: settled -> open should throw TransitionNotAllowedError', () => {
      expect(() => assertAllowedDbStatusTransition({ fromStatus: 'settled', toStatus: 'open', actor: ACTORS.ADMIN }))
        .toThrow(TransitionNotAllowedError);
      expect(() => assertAllowedDbStatusTransition({ fromStatus: 'settled', toStatus: 'open', actor: ACTORS.ADMIN }))
        .toThrow("Transition from 'settled' to 'open' is not allowed for ADMIN");
    });

    // SYSTEM
    test('SYSTEM: draft -> open should throw TransitionNotAllowedError', () => {
      expect(() => assertAllowedDbStatusTransition({ fromStatus: 'draft', toStatus: 'open', actor: ACTORS.SYSTEM }))
        .toThrow(TransitionNotAllowedError);
      expect(() => assertAllowedDbStatusTransition({ fromStatus: 'draft', toStatus: 'open', actor: ACTORS.SYSTEM }))
        .toThrow("Transition from 'draft' to 'open' is not allowed for SYSTEM");
    });

    test('SYSTEM: locked -> open should throw TransitionNotAllowedError', () => {
      expect(() => assertAllowedDbStatusTransition({ fromStatus: 'locked', toStatus: 'open', actor: ACTORS.SYSTEM }))
        .toThrow(TransitionNotAllowedError);
      expect(() => assertAllowedDbStatusTransition({ fromStatus: 'locked', toStatus: 'open', actor: ACTORS.SYSTEM }))
        .toThrow("Transition from 'locked' to 'open' is not allowed for SYSTEM");
    });
  });

  // Test cases for terminal states
  describe('Terminal State Protection', () => {
    test('Transition from settled should always throw', () => {
      const terminalStatuses = ['open', 'locked', 'draft', 'cancelled'];
      terminalStatuses.forEach(toStatus => {
        expect(() => assertAllowedDbStatusTransition({ fromStatus: 'settled', toStatus: toStatus, actor: ACTORS.ORGANIZER }))
          .toThrow(TransitionNotAllowedError);
        expect(() => assertAllowedDbStatusTransition({ fromStatus: 'settled', toStatus: toStatus, actor: ACTORS.ORGANIZER }))
          .toThrow(`Transition from 'settled' to '${toStatus}' is not allowed for ORGANIZER`);
      });
    });

    test('Transition from cancelled should always throw', () => {
      const terminalStatuses = ['open', 'locked', 'draft', 'settled'];
      terminalStatuses.forEach(toStatus => {
        expect(() => assertAllowedDbStatusTransition({ fromStatus: 'cancelled', toStatus: toStatus, actor: ACTORS.ADMIN }))
          .toThrow(TransitionNotAllowedError);
        expect(() => assertAllowedDbStatusTransition({ fromStatus: 'cancelled', toStatus: toStatus, actor: ACTORS.ADMIN }))
          .toThrow(`Transition from 'cancelled' to '${toStatus}' is not allowed for ADMIN`);
      });
    });
  });

  // Test cases for invalid actor or status
  describe('Invalid Inputs', () => {
    test('Should throw for unknown actor', () => {
      expect(() => assertAllowedDbStatusTransition({ fromStatus: 'draft', toStatus: 'open', actor: 'UNKNOWN_ACTOR' }))
        .toThrow(TransitionNotAllowedError);
      expect(() => assertAllowedDbStatusTransition({ fromStatus: 'draft', toStatus: 'open', actor: 'UNKNOWN_ACTOR' }))
        .toThrow("Transition from 'draft' to 'open' is not allowed for UNKNOWN_ACTOR");
    });

    test('Should throw for invalid fromStatus', () => {
      expect(() => assertAllowedDbStatusTransition({ fromStatus: 'invalid', toStatus: 'open', actor: ACTORS.ORGANIZER }))
        .toThrow(TransitionNotAllowedError);
      expect(() => assertAllowedDbStatusTransition({ fromStatus: 'invalid', toStatus: 'open', actor: ACTORS.ORGANIZER }))
        .toThrow("Transition from 'invalid' to 'open' is not allowed for ORGANIZER");
    });

    test('Should throw for invalid toStatus', () => {
      expect(() => assertAllowedDbStatusTransition({ fromStatus: 'draft', toStatus: 'invalid', actor: ACTORS.ORGANIZER }))
        .toThrow(TransitionNotAllowedError);
      expect(() => assertAllowedDbStatusTransition({ fromStatus: 'draft', toStatus: 'invalid', actor: ACTORS.ORGANIZER }))
        .toThrow("Transition from 'draft' to 'invalid' is not allowed for ORGANIZER");
    });
  });
});
