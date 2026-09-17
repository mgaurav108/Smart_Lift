# Smart Lift Specifications

## Overview

This document outlines the specifications for the Smart Lift project. The goal is to design and develop a smart lift system that provides a safe, efficient, and user-friendly
experience for passengers.

## User Stories

### User Story 1: User Authentication

* As a user, I want to be able to authenticate using a valid username and password so that I can access the lift system.
* Given a valid username and password, the system should allow access to the lift.
* Given an invalid username or password, the system should deny access to the lift.

### User Story 2: Floor Selection

* As a user, I want to be able to select the desired floor using a control panel or mobile app so that I can travel to my desired destination.
* Given a valid floor selection, the system should move the lift to the selected floor.
* Given an invalid floor selection, the system should display an error message and not move the lift.

### User Story 3: Lift Movement

* As a user, I want the lift to move to the selected floor safely and efficiently so that I can reach my destination quickly.
* The system should ensure that the lift moves at a safe speed and stops at the correct floor.
* The system should also handle any unexpected events, such as a power outage or technical fault.

### User Story 4: Emergency Stop

* As a user, I want to be able to stop the lift in case of an emergency so that I can exit the lift safely.
* Given an emergency situation, the user should be able to stop the lift using a designated button or control.
* The system should immediately stop the lift and alert nearby personnel.

### User Story 5: Fault Detection

* As a user, I want the system to detect any faults or issues with the lift so that I can be aware of any potential hazards.
* The system should continuously monitor the lift's status and alert users and nearby personnel in case of a fault.
* The system should also provide a history of faults and maintenance records for easy access.

### User Story 6: Destination Dispatch (DCS)

* As a user, I want to enter my destination at a lobby kiosk *before* boarding so that the system can assign me a specific car and group passengers.
* Given a valid destination selection, the system should display my assigned car ("Take Lift C"), its pickup ETA, and its planned stops.
* Given the assigned car arriving with its doors open, I should be able to board it; boarding any other car must be rejected.
* The system should batch passengers with compatible trips (same direction, nearby destinations) into the same car to reduce stops and travel time.
* The system should handle passengers who do not board their assigned car (no-show) by releasing the seat and allowing re-registration.

> Implemented in `Spec/phase2-dcs.md` and `simulation/dcs/` (Phase 2).

## Technical Requirements

* The system should be designed to be scalable and modular, with separate components for the control panel, mobile app, and lift hardware.
* The system should use a secure authentication mechanism to prevent unauthorized access.
* The system should be able to communicate with the lift hardware using a standardized protocol.

## Acceptance Criteria

* The system should meet all the technical requirements outlined above.
* The system should pass all the user stories outlined above.
* The system should be able to handle a large number of users and floors without compromising performance.

## Next Steps

* Develop a detailed design for the system, including the architecture, components, and interfaces.
* Implement the system using the specified technologies and protocols.
* Test the system thoroughly to ensure it meets all the requirements and user stories.

## Glossary

* **Floor**: A designated level or stop in the lift system.
* **Lift**: The moving vehicle that transports users between floors.
* **User**: A person who uses the lift system.
* **Control Panel**: The interface used by users to select the desired floor and control the lift.
* **Mobile App**: A software application that allows users to control the lift remotely.