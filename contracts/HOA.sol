pragma solidity ^0.8.24;

import { FHE, euint32, externalEuint32 } from "@fhevm/solidity/lib/FHE.sol";
import { ZamaEthereumConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract VotingContract is ZamaEthereumConfig {
    struct Proposal {
        string title;
        euint32 encryptedVotes;
        uint256 startTime;
        uint256 endTime;
        bool isActive;
        uint32 decryptedVotes;
        bool isTallied;
    }

    struct Voter {
        bool isRegistered;
        bool hasVoted;
    }

    address public chairperson;
    mapping(address => Voter) public voters;
    mapping(string => Proposal) public proposals;
    string[] public proposalIds;

    event ProposalCreated(string indexed proposalId, address indexed creator);
    event VoteCast(address indexed voter, string indexed proposalId);
    event VotesTallied(string indexed proposalId, uint32 decryptedVotes);

    modifier onlyChairperson() {
        require(msg.sender == chairperson, "Only chairperson can perform this action");
        _;
    }

    constructor() ZamaEthereumConfig() {
        chairperson = msg.sender;
    }

    function registerVoter(address voter) external onlyChairperson {
        require(!voters[voter].isRegistered, "Voter already registered");
        voters[voter] = Voter(true, false);
    }

    function createProposal(
        string calldata proposalId,
        string calldata title,
        uint256 startTime,
        uint256 endTime
    ) external onlyChairperson {
        require(bytes(proposals[proposalId].title).length == 0, "Proposal already exists");
        require(endTime > startTime, "End time must be after start time");

        proposals[proposalId] = Proposal({
            title: title,
            encryptedVotes: FHE.zero(),
            startTime: startTime,
            endTime: endTime,
            isActive: true,
            decryptedVotes: 0,
            isTallied: false
        });

        FHE.allowThis(proposals[proposalId].encryptedVotes);
        FHE.makePubliclyDecryptable(proposals[proposalId].encryptedVotes);

        proposalIds.push(proposalId);
        emit ProposalCreated(proposalId, msg.sender);
    }

    function castVote(
        string calldata proposalId,
        externalEuint32 encryptedVote,
        bytes calldata inputProof
    ) external {
        require(voters[msg.sender].isRegistered, "Voter not registered");
        require(!voters[msg.sender].hasVoted, "Voter has already voted");
        require(bytes(proposals[proposalId].title).length > 0, "Proposal does not exist");
        require(block.timestamp >= proposals[proposalId].startTime, "Voting has not started");
        require(block.timestamp <= proposals[proposalId].endTime, "Voting has ended");
        require(proposals[proposalId].isActive, "Voting is not active");

        require(FHE.isInitialized(FHE.fromExternal(encryptedVote, inputProof)), "Invalid encrypted vote");

        euint32 vote = FHE.fromExternal(encryptedVote, inputProof);
        proposals[proposalId].encryptedVotes = FHE.add(proposals[proposalId].encryptedVotes, vote);

        voters[msg.sender].hasVoted = true;
        emit VoteCast(msg.sender, proposalId);
    }

    function tallyVotes(
        string calldata proposalId,
        bytes memory abiEncodedClearValue,
        bytes memory decryptionProof
    ) external onlyChairperson {
        require(bytes(proposals[proposalId].title).length > 0, "Proposal does not exist");
        require(!proposals[proposalId].isTallied, "Votes already tallied");
        require(block.timestamp > proposals[proposalId].endTime, "Voting period has not ended");

        bytes32[] memory cts = new bytes32[](1);
        cts[0] = FHE.toBytes32(proposals[proposalId].encryptedVotes);

        FHE.checkSignatures(cts, abiEncodedClearValue, decryptionProof);

        uint32 decodedValue = abi.decode(abiEncodedClearValue, (uint32));
        proposals[proposalId].decryptedVotes = decodedValue;
        proposals[proposalId].isTallied = true;
        proposals[proposalId].isActive = false;

        emit VotesTallied(proposalId, decodedValue);
    }

    function getProposal(string calldata proposalId) external view returns (
        string memory title,
        uint256 startTime,
        uint256 endTime,
        bool isActive,
        uint32 decryptedVotes,
        bool isTallied
    ) {
        require(bytes(proposals[proposalId].title).length > 0, "Proposal does not exist");
        Proposal storage p = proposals[proposalId];
        return (p.title, p.startTime, p.endTime, p.isActive, p.decryptedVotes, p.isTallied);
    }

    function getAllProposalIds() external view returns (string[] memory) {
        return proposalIds;
    }

    function getEncryptedVotes(string calldata proposalId) external view returns (euint32) {
        require(bytes(proposals[proposalId].title).length > 0, "Proposal does not exist");
        return proposals[proposalId].encryptedVotes;
    }

    function isAvailable() public pure returns (bool) {
        return true;
    }
}

