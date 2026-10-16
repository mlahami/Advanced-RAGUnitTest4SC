// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

/// @title BOTPass
/// @notice Multi-organizer Open Claim attendance records on BOT Chain.
contract BOTPass {
    uint256 private constant _MAX_NAME_LENGTH = 100;
    uint256 private constant _MAX_DESCRIPTION_LENGTH = 500;
    uint256 private constant _MAX_LOCATION_LENGTH = 200;

    uint8 private constant _FIELD_NAME = 0;
    uint8 private constant _FIELD_DESCRIPTION = 1;
    uint8 private constant _FIELD_LOCATION = 2;

    struct EventData {
        address organizer;
        string name;
        string description;
        string location;
        uint64 startTime;
        uint64 endTime;
        bool claimOpen;
        uint256 passCount;
    }

    uint256 public eventCount;

    mapping(uint256 eventId => EventData eventData) private _events;
    mapping(uint256 eventId => mapping(address attendee => uint64 timestamp))
        private _claimedAt;

    event EventCreated(
        uint256 indexed eventId,
        address indexed organizer,
        uint64 startTime,
        uint64 endTime
    );
    event ClaimOpenChanged(uint256 indexed eventId, bool isOpen);
    event PassClaimed(
        uint256 indexed eventId,
        address indexed attendee,
        uint64 claimedAt
    );

    error EventNotFound(uint256 eventId);
    error EmptyField(uint8 field);
    error FieldTooLong(uint8 field, uint256 actualLength, uint256 maximumLength);
    error InvalidTimeRange(uint64 startTime, uint64 endTime);
    error EndTimeNotFuture(uint64 endTime);
    error UnauthorizedOrganizer(uint256 eventId, address caller);
    error ClaimClosed(uint256 eventId);
    error EventNotStarted(uint256 eventId, uint64 startTime);
    error EventEnded(uint256 eventId, uint64 endTime);
    error AlreadyClaimed(uint256 eventId, address attendee);

    function createEvent(
        string calldata name,
        string calldata description,
        string calldata location,
        uint64 startTime,
        uint64 endTime
    ) external returns (uint256 eventId) {
        _validateField(name, _FIELD_NAME, _MAX_NAME_LENGTH);
        _validateField(description, _FIELD_DESCRIPTION, _MAX_DESCRIPTION_LENGTH);
        _validateField(location, _FIELD_LOCATION, _MAX_LOCATION_LENGTH);

        if (endTime <= startTime) {
            revert InvalidTimeRange(startTime, endTime);
        }
        if (uint256(endTime) <= block.timestamp) {
            revert EndTimeNotFuture(endTime);
        }

        eventId = ++eventCount;
        _events[eventId] = EventData({
            organizer: msg.sender,
            name: name,
            description: description,
            location: location,
            startTime: startTime,
            endTime: endTime,
            claimOpen: false,
            passCount: 0
        });

        emit EventCreated(eventId, msg.sender, startTime, endTime);
    }

    function setClaimOpen(uint256 eventId, bool isOpen) external {
        EventData storage eventData = _getExistingEvent(eventId);
        if (eventData.organizer != msg.sender) {
            revert UnauthorizedOrganizer(eventId, msg.sender);
        }

        eventData.claimOpen = isOpen;
        emit ClaimOpenChanged(eventId, isOpen);
    }

    function getEvent(uint256 eventId) external view returns (EventData memory) {
        return _getExistingEvent(eventId);
    }

    function claimOpen(uint256 eventId) external returns (uint64 timestamp) {
        EventData storage eventData = _getExistingEvent(eventId);
        if (!eventData.claimOpen) {
            revert ClaimClosed(eventId);
        }
        if (block.timestamp < uint256(eventData.startTime)) {
            revert EventNotStarted(eventId, eventData.startTime);
        }
        if (block.timestamp > uint256(eventData.endTime)) {
            revert EventEnded(eventId, eventData.endTime);
        }
        if (_claimedAt[eventId][msg.sender] != 0) {
            revert AlreadyClaimed(eventId, msg.sender);
        }

        timestamp = uint64(block.timestamp);
        _claimedAt[eventId][msg.sender] = timestamp;
        eventData.passCount += 1;

        emit PassClaimed(eventId, msg.sender, timestamp);
    }

    function claimedAt(
        uint256 eventId,
        address attendee
    ) external view returns (uint64) {
        _getExistingEvent(eventId);
        return _claimedAt[eventId][attendee];
    }

    function _validateField(
        string calldata value,
        uint8 field,
        uint256 maximumLength
    ) private pure {
        uint256 actualLength = bytes(value).length;
        if (actualLength == 0) {
            revert EmptyField(field);
        }
        if (actualLength > maximumLength) {
            revert FieldTooLong(field, actualLength, maximumLength);
        }
    }

    function _getExistingEvent(
        uint256 eventId
    ) private view returns (EventData storage eventData) {
        if (eventId == 0 || eventId > eventCount) {
            revert EventNotFound(eventId);
        }
        return _events[eventId];
    }
}
