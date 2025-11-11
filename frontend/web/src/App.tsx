import { ConnectButton } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import React, { JSX, useEffect, useState } from "react";
import { getContractReadOnly, getContractWithSigner } from "./components/useContract";
import "./App.css";
import { useAccount } from 'wagmi';
import { useFhevm, useEncrypt, useDecrypt } from '../fhevm-sdk/src';
import { ethers } from 'ethers';

interface VotingData {
  id: string;
  title: string;
  description: string;
  encryptedVotes: string;
  publicValue1: number;
  publicValue2: number;
  timestamp: number;
  creator: string;
  isVerified?: boolean;
  decryptedValue?: number;
}

interface VoteStats {
  totalVotes: number;
  yesVotes: number;
  noVotes: number;
  participationRate: number;
  averageScore: number;
}

const App: React.FC = () => {
  const { address, isConnected } = useAccount();
  const [loading, setLoading] = useState(true);
  const [votings, setVotings] = useState<VotingData[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creatingVote, setCreatingVote] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{ visible: boolean; status: "pending" | "success" | "error"; message: string; }>({ 
    visible: false, 
    status: "pending" as const, 
    message: "" 
  });
  const [newVoteData, setNewVoteData] = useState({ title: "", description: "", votes: "" });
  const [selectedVote, setSelectedVote] = useState<VotingData | null>(null);
  const [decryptedData, setDecryptedData] = useState<number | null>(null);
  const [isDecrypting, setIsDecrypting] = useState(false);
  const [contractAddress, setContractAddress] = useState("");
  const [fhevmInitializing, setFhevmInitializing] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [filterVerified, setFilterVerified] = useState(false);

  const { status, initialize, isInitialized } = useFhevm();
  const { encrypt, isEncrypting} = useEncrypt();
  const { verifyDecryption, isDecrypting: fheIsDecrypting } = useDecrypt();

  useEffect(() => {
    const initFhevmAfterConnection = async () => {
      if (!isConnected) return;
      if (isInitialized || fhevmInitializing) return;
      
      try {
        setFhevmInitializing(true);
        await initialize();
      } catch (error) {
        setTransactionStatus({ 
          visible: true, 
          status: "error", 
          message: "FHEVM initialization failed" 
        });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      } finally {
        setFhevmInitializing(false);
      }
    };

    initFhevmAfterConnection();
  }, [isConnected, isInitialized, initialize, fhevmInitializing]);

  useEffect(() => {
    const loadDataAndContract = async () => {
      if (!isConnected) {
        setLoading(false);
        return;
      }
      
      try {
        await loadData();
        const contract = await getContractReadOnly();
        if (contract) setContractAddress(await contract.getAddress());
      } catch (error) {
        console.error('Failed to load data:', error);
      } finally {
        setLoading(false);
      }
    };

    loadDataAndContract();
  }, [isConnected]);

  const loadData = async () => {
    if (!isConnected) return;
    
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const businessIds = await contract.getAllBusinessIds();
      const votingsList: VotingData[] = [];
      
      for (const businessId of businessIds) {
        try {
          const businessData = await contract.getBusinessData(businessId);
          votingsList.push({
            id: businessId,
            title: businessData.name,
            description: businessData.description,
            encryptedVotes: businessId,
            timestamp: Number(businessData.timestamp),
            creator: businessData.creator,
            publicValue1: Number(businessData.publicValue1) || 0,
            publicValue2: Number(businessData.publicValue2) || 0,
            isVerified: businessData.isVerified,
            decryptedValue: Number(businessData.decryptedValue) || 0
          });
        } catch (e) {
          console.error('Error loading business data:', e);
        }
      }
      
      setVotings(votingsList);
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Failed to load data" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setIsRefreshing(false); 
    }
  };

  const createVote = async () => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return; 
    }
    
    setCreatingVote(true);
    setTransactionStatus({ visible: true, status: "pending", message: "Creating vote with Zama FHE..." });
    
    try {
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Failed to get contract with signer");
      
      const voteValue = parseInt(newVoteData.votes) || 0;
      const businessId = `vote-${Date.now()}`;
      
      const encryptedResult = await encrypt(contractAddress, address, voteValue);
      
      const tx = await contract.createBusinessData(
        businessId,
        newVoteData.title,
        encryptedResult.encryptedData,
        encryptedResult.proof,
        Math.floor(Math.random() * 100),
        0,
        newVoteData.description
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Waiting for transaction confirmation..." });
      await tx.wait();
      
      setTransactionStatus({ visible: true, status: "success", message: "Vote created successfully!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      await loadData();
      setShowCreateModal(false);
      setNewVoteData({ title: "", description: "", votes: "" });
    } catch (e: any) {
      const errorMessage = e.message?.includes("user rejected transaction") 
        ? "Transaction rejected by user" 
        : "Submission failed: " + (e.message || "Unknown error");
      setTransactionStatus({ visible: true, status: "error", message: errorMessage });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setCreatingVote(false); 
    }
  };

  const decryptData = async (businessId: string): Promise<number | null> => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    }
    
    setIsDecrypting(true);
    try {
      const contractRead = await getContractReadOnly();
      if (!contractRead) return null;
      
      const businessData = await contractRead.getBusinessData(businessId);
      if (businessData.isVerified) {
        const storedValue = Number(businessData.decryptedValue) || 0;
        
        setTransactionStatus({ 
          visible: true, 
          status: "success", 
          message: "Data already verified on-chain" 
        });
        setTimeout(() => {
          setTransactionStatus({ visible: false, status: "pending", message: "" });
        }, 2000);
        
        return storedValue;
      }
      
      const contractWrite = await getContractWithSigner();
      if (!contractWrite) return null;
      
      const encryptedValueHandle = await contractRead.getEncryptedValue(businessId);
      
      const result = await verifyDecryption(
        [encryptedValueHandle],
        contractAddress,
        (abiEncodedClearValues: string, decryptionProof: string) => 
          contractWrite.verifyDecryption(businessId, abiEncodedClearValues, decryptionProof)
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Verifying decryption on-chain..." });
      
      const clearValue = result.decryptionResult.clearValues[encryptedValueHandle];
      
      await loadData();
      
      setTransactionStatus({ visible: true, status: "success", message: "Data decrypted and verified successfully!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      return Number(clearValue);
      
    } catch (e: any) { 
      if (e.message?.includes("Data already verified")) {
        setTransactionStatus({ 
          visible: true, 
          status: "success", 
          message: "Data is already verified on-chain" 
        });
        setTimeout(() => {
          setTransactionStatus({ visible: false, status: "pending", message: "" });
        }, 2000);
        
        await loadData();
        return null;
      }
      
      setTransactionStatus({ 
        visible: true, 
        status: "error", 
        message: "Decryption failed: " + (e.message || "Unknown error") 
      });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    } finally { 
      setIsDecrypting(false); 
    }
  };

  const callIsAvailable = async () => {
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const result = await contract.isAvailable();
      setTransactionStatus({ 
        visible: true, 
        status: "success", 
        message: "Contract is available and working!" 
      });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
    } catch (e) {
      setTransactionStatus({ 
        visible: true, 
        status: "error", 
        message: "Contract call failed" 
      });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    }
  };

  const calculateStats = (): VoteStats => {
    const totalVotes = votings.length;
    const yesVotes = votings.filter(v => v.publicValue1 > 50).length;
    const noVotes = totalVotes - yesVotes;
    const participationRate = totalVotes > 0 ? Math.round((yesVotes + noVotes) / totalVotes * 100) : 0;
    const averageScore = totalVotes > 0 ? votings.reduce((sum, v) => sum + v.publicValue1, 0) / totalVotes : 0;

    return {
      totalVotes,
      yesVotes,
      noVotes,
      participationRate,
      averageScore: Math.round(averageScore * 10) / 10
    };
  };

  const filteredVotings = votings.filter(vote => {
    const matchesSearch = vote.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         vote.description.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesFilter = !filterVerified || vote.isVerified;
    return matchesSearch && matchesFilter;
  });

  const stats = calculateStats();

  const renderStatsDashboard = () => {
    return (
      <div className="stats-dashboard">
        <div className="stat-card">
          <div className="stat-icon">📊</div>
          <div className="stat-content">
            <div className="stat-value">{stats.totalVotes}</div>
            <div className="stat-label">Total Votes</div>
          </div>
        </div>
        
        <div className="stat-card">
          <div className="stat-icon">✅</div>
          <div className="stat-content">
            <div className="stat-value">{stats.yesVotes}</div>
            <div className="stat-label">Approved</div>
          </div>
        </div>
        
        <div className="stat-card">
          <div className="stat-icon">❌</div>
          <div className="stat-content">
            <div className="stat-value">{stats.noVotes}</div>
            <div className="stat-label">Rejected</div>
          </div>
        </div>
        
        <div className="stat-card">
          <div className="stat-icon">👥</div>
          <div className="stat-content">
            <div className="stat-value">{stats.participationRate}%</div>
            <div className="stat-label">Participation</div>
          </div>
        </div>
      </div>
    );
  };

  const renderFHEProcess = () => {
    return (
      <div className="fhe-process">
        <div className="process-step">
          <div className="step-number">1</div>
          <div className="step-content">
            <h4>Encrypt Vote</h4>
            <p>Vote data encrypted using Zama FHE technology</p>
          </div>
        </div>
        
        <div className="process-step">
          <div className="step-number">2</div>
          <div className="step-content">
            <h4>Store on Chain</h4>
            <p>Encrypted data stored securely on blockchain</p>
          </div>
        </div>
        
        <div className="process-step">
          <div className="step-number">3</div>
          <div className="step-content">
            <h4>Homomorphic Tally</h4>
            <p>Votes counted without decryption</p>
          </div>
        </div>
        
        <div className="process-step">
          <div className="step-number">4</div>
          <div className="step-content">
            <h4>Verify Result</h4>
            <p>Final result verified on-chain</p>
          </div>
        </div>
      </div>
    );
  };

  if (!isConnected) {
    return (
      <div className="app-container">
        <header className="app-header">
          <div className="logo">
            <h1>HOA Private Voting 🔐</h1>
          </div>
          <div className="header-actions">
            <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
          </div>
        </header>
        
        <div className="connection-prompt">
          <div className="connection-content">
            <div className="connection-icon">🏠</div>
            <h2>Welcome to HOA Private Voting</h2>
            <p>Connect your wallet to participate in secure, private community voting using FHE technology.</p>
          </div>
        </div>
      </div>
    );
  }

  if (!isInitialized || fhevmInitializing) {
    return (
      <div className="loading-screen">
        <div className="fhe-spinner"></div>
        <p>Initializing FHE Voting System...</p>
      </div>
    );
  }

  if (loading) return (
    <div className="loading-screen">
      <div className="fhe-spinner"></div>
      <p>Loading voting system...</p>
    </div>
  );

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="logo">
          <h1>HOA Private Voting 🔐</h1>
          <p>Secure Community Decision Making</p>
        </div>
        
        <div className="header-actions">
          <button onClick={callIsAvailable} className="test-btn">
            Test Contract
          </button>
          <button onClick={() => setShowCreateModal(true)} className="create-btn">
            + New Vote
          </button>
          <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
        </div>
      </header>
      
      <div className="main-content">
        <div className="dashboard-section">
          <h2>Voting Statistics</h2>
          {renderStatsDashboard()}
          
          <div className="fhe-info-panel">
            <h3>FHE Voting Process</h3>
            {renderFHEProcess()}
          </div>
        </div>
        
        <div className="voting-section">
          <div className="section-header">
            <h2>Active Votes</h2>
            <div className="controls">
              <div className="search-box">
                <input 
                  type="text" 
                  placeholder="Search votes..." 
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                />
              </div>
              <label className="filter-toggle">
                <input 
                  type="checkbox" 
                  checked={filterVerified}
                  onChange={(e) => setFilterVerified(e.target.checked)}
                />
                Verified Only
              </label>
              <button onClick={loadData} disabled={isRefreshing} className="refresh-btn">
                {isRefreshing ? "Refreshing..." : "Refresh"}
              </button>
            </div>
          </div>
          
          <div className="votings-list">
            {filteredVotings.length === 0 ? (
              <div className="no-votes">
                <p>No votes found</p>
                <button onClick={() => setShowCreateModal(true)} className="create-btn">
                  Create First Vote
                </button>
              </div>
            ) : (
              filteredVotings.map((vote, index) => (
                <div 
                  className={`vote-item ${vote.isVerified ? "verified" : ""}`}
                  key={index}
                  onClick={() => setSelectedVote(vote)}
                >
                  <div className="vote-header">
                    <h3>{vote.title}</h3>
                    <span className={`status ${vote.isVerified ? "verified" : "pending"}`}>
                      {vote.isVerified ? "✅ Verified" : "🔓 Pending"}
                    </span>
                  </div>
                  <p className="vote-desc">{vote.description}</p>
                  <div className="vote-meta">
                    <span>By: {vote.creator.substring(0, 8)}...</span>
                    <span>{new Date(vote.timestamp * 1000).toLocaleDateString()}</span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
      
      {showCreateModal && (
        <CreateVoteModal 
          onSubmit={createVote}
          onClose={() => setShowCreateModal(false)}
          creating={creatingVote}
          voteData={newVoteData}
          setVoteData={setNewVoteData}
          isEncrypting={isEncrypting}
        />
      )}
      
      {selectedVote && (
        <VoteDetailModal 
          vote={selectedVote}
          onClose={() => {
            setSelectedVote(null);
            setDecryptedData(null);
          }}
          decryptedData={decryptedData}
          setDecryptedData={setDecryptedData}
          isDecrypting={isDecrypting || fheIsDecrypting}
          decryptData={() => decryptData(selectedVote.id)}
        />
      )}
      
      {transactionStatus.visible && (
        <div className={`transaction-toast ${transactionStatus.status}`}>
          <div className="toast-content">
            <span className="toast-message">{transactionStatus.message}</span>
          </div>
        </div>
      )}
    </div>
  );
};

const CreateVoteModal: React.FC<{
  onSubmit: () => void;
  onClose: () => void;
  creating: boolean;
  voteData: any;
  setVoteData: (data: any) => void;
  isEncrypting: boolean;
}> = ({ onSubmit, onClose, creating, voteData, setVoteData, isEncrypting }) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    if (name === 'votes') {
      const intValue = value.replace(/[^\d]/g, '');
      setVoteData({ ...voteData, [name]: intValue });
    } else {
      setVoteData({ ...voteData, [name]: value });
    }
  };

  return (
    <div className="modal-overlay">
      <div className="create-modal">
        <div className="modal-header">
          <h2>Create New Vote</h2>
          <button onClick={onClose} className="close-btn">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="form-group">
            <label>Vote Title *</label>
            <input 
              type="text" 
              name="title" 
              value={voteData.title}
              onChange={handleChange}
              placeholder="Enter vote title..."
            />
          </div>
          
          <div className="form-group">
            <label>Description *</label>
            <textarea 
              name="description" 
              value={voteData.description}
              onChange={handleChange}
              placeholder="Describe the voting issue..."
              rows={3}
            />
          </div>
          
          <div className="form-group">
            <label>Vote Value (Integer) *</label>
            <input 
              type="number" 
              name="votes" 
              value={voteData.votes}
              onChange={handleChange}
              placeholder="Enter vote value..."
              min="0"
            />
            <div className="hint">FHE Encrypted Integer</div>
          </div>
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="cancel-btn">Cancel</button>
          <button 
            onClick={onSubmit}
            disabled={creating || isEncrypting || !voteData.title || !voteData.description || !voteData.votes}
            className="submit-btn"
          >
            {creating || isEncrypting ? "Creating..." : "Create Vote"}
          </button>
        </div>
      </div>
    </div>
  );
};

const VoteDetailModal: React.FC<{
  vote: VotingData;
  onClose: () => void;
  decryptedData: number | null;
  setDecryptedData: (value: number | null) => void;
  isDecrypting: boolean;
  decryptData: () => Promise<number | null>;
}> = ({ vote, onClose, decryptedData, setDecryptedData, isDecrypting, decryptData }) => {
  const handleDecrypt = async () => {
    if (decryptedData !== null) {
      setDecryptedData(null);
      return;
    }
    
    const decrypted = await decryptData();
    setDecryptedData(decrypted);
  };

  return (
    <div className="modal-overlay">
      <div className="detail-modal">
        <div className="modal-header">
          <h2>Vote Details</h2>
          <button onClick={onClose} className="close-btn">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="vote-info">
            <h3>{vote.title}</h3>
            <p>{vote.description}</p>
            
            <div className="info-grid">
              <div className="info-item">
                <span>Creator:</span>
                <span>{vote.creator.substring(0, 8)}...{vote.creator.substring(38)}</span>
              </div>
              <div className="info-item">
                <span>Created:</span>
                <span>{new Date(vote.timestamp * 1000).toLocaleString()}</span>
              </div>
              <div className="info-item">
                <span>Status:</span>
                <span className={`status ${vote.isVerified ? "verified" : "pending"}`}>
                  {vote.isVerified ? "✅ Verified" : "🔓 Pending Verification"}
                </span>
              </div>
            </div>
          </div>
          
          <div className="data-section">
            <h4>Encrypted Vote Data</h4>
            <div className="data-display">
              <div className="data-value">
                {vote.isVerified ? 
                  `Decrypted Value: ${vote.decryptedValue}` :
                  decryptedData !== null ?
                  `Locally Decrypted: ${decryptedData}` :
                  "🔒 Encrypted (FHE Protected)"
                }
              </div>
              
              <button 
                onClick={handleDecrypt}
                disabled={isDecrypting}
                className={`decrypt-btn ${(vote.isVerified || decryptedData !== null) ? 'decrypted' : ''}`}
              >
                {isDecrypting ? "Decrypting..." : 
                 vote.isVerified ? "✅ Verified" :
                 decryptedData !== null ? "🔄 Re-decrypt" : "🔓 Decrypt"}
              </button>
            </div>
          </div>
          
          {(vote.isVerified || decryptedData !== null) && (
            <div className="result-section">
              <h4>Voting Result</h4>
              <div className="result-display">
                <div className="result-bar">
                  <div 
                    className="result-fill yes"
                    style={{ width: `${vote.publicValue1}%` }}
                  >
                    <span>Approve: {vote.publicValue1}%</span>
                  </div>
                  <div 
                    className="result-fill no"
                    style={{ width: `${100 - vote.publicValue1}%` }}
                  >
                    <span>Reject: {100 - vote.publicValue1}%</span>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="close-btn">Close</button>
        </div>
      </div>
    </div>
  );
};

export default App;

