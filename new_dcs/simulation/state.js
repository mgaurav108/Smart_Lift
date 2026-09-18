/* Smart Lift - New DCS simulation: SimulationState.
 * Owns ALL mutable simulation state (Spec/phase-3-newdcs.md §62: no hidden
 * global state). The SimulationEngine and DispatchEngine receive this
 * object explicitly; nothing else holds mutable copies.
 */
(function (global) {
  'use strict';

  var Floor = (typeof require === 'function' && typeof module !== 'undefined' && module.exports)
    ? require('../domain/floor.js')
    : (global.SmartLift && global.SmartLift.NewDCS && global.SmartLift.NewDCS.Floor);
  var Elevator = (typeof require === 'function' && typeof module !== 'undefined' && module.exports)
    ? require('../domain/elevator.js')
    : (global.SmartLift && global.SmartLift.NewDCS && global.SmartLift.NewDCS.Elevator);

  function create(config) {
    var elevConfig = config.elevators;
    var initialFloors = elevConfig.initialFloors || [];
    var elevators = [];
    for (var i = 0; i < elevConfig.count; i += 1) {
      var start = initialFloors.length ? initialFloors[i] : elevConfig.startFloor;
      elevators.push(Elevator.create(i, elevConfig.capacity, start));
    }

    return {
      config: config,
      floorRange: Floor.create(config.building.floors, config.building.groundFloor),
      clock: null,                // set by SimulationEngine.create
      elevators: elevators,
      requests: {},               // requestId -> DestinationRequest
      queuedRequestIds: [],       // FIFO of requests awaiting an elevator
      nextRequestSeq: 0,
      nextPassengerSeq: 0,
      nextRequestId: function () {
        var id = 'R' + this.nextRequestSeq;
        this.nextRequestSeq += 1;
        return id;
      },
      nextPassengerId: function () {
        var id = 'P' + this.nextPassengerSeq;
        this.nextPassengerSeq += 1;
        return id;
      }
    };
  }

  var SimulationState = {
    create: create
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = SimulationState;
  }
  global.SmartLift = global.SmartLift || {};
  global.SmartLift.NewDCS = global.SmartLift.NewDCS || {};
  global.SmartLift.NewDCS.SimulationState = SimulationState;
}(typeof window !== 'undefined' ? window : globalThis));