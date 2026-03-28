# File: training/pipeline.py
# The Final Sentinel Evolution — Training Pipeline Orchestrator

import os
import sys
import json
import torch  # type: ignore
from torch.utils.data import Dataset, DataLoader  # type: ignore

# Ensure local imports work correctly from any CWD
sys.path.append(os.path.dirname(os.path.abspath(__file__)))
from sentinel_brain_v2 import SentinelBrainV2, FocalLoss  # type: ignore

class SentinelDataset(Dataset):
    def __init__(self, data_path):
        self.data = []
        with open(data_path, 'r') as f:
            for line in f:
                self.data.append(json.loads(line))
                
    def __len__(self):
        return len(self.data)
        
    def __getitem__(self, idx):
        item = self.data[idx]
        # features is a 128-dim list
        features = torch.tensor(item['features'], dtype=torch.float32)
        label = torch.tensor(item['label_idx'], dtype=torch.long)
        return features, label

def train_sentinel():
    # 1. SETUP
    device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
    model = SentinelBrainV2().to(device)
    
    # 2. DATA
    base_dir = os.path.dirname(__file__)
    data_path = os.path.join(base_dir, 'data', 'sentinel_v2_seed.jsonl')
    dataset = SentinelDataset(data_path)
    train_size = int(0.9 * len(dataset))
    val_size = len(dataset) - train_size
    train_set, val_set = torch.utils.data.random_split(dataset, [train_size, val_size])
    
    train_loader = DataLoader(train_set, batch_size=512, shuffle=True)
    val_loader = DataLoader(val_set, batch_size=512)
    
    # 3. OPTIMIZATION
    optimizer = torch.optim.AdamW(model.parameters(), lr=3e-4, weight_decay=0.01)
    # Class mapping: [0:username, 1:email, 2:password, 3:confirm_pass, 4:otp, 5:phone, 6:submit, 7:honeypot, 8:unknown]
    class_weights = torch.tensor([1.0, 1.0, 1.0, 1.5, 1.5, 1.2, 1.0, 2.0, 0.8]).to(device)
    criterion = FocalLoss(alpha=class_weights)
    
    # 4. TRAINING LOOP
    for epoch in range(10):
        model.train()
        train_loss = 0
        for features, labels in train_loader:
            features, labels = features.to(device), labels.to(device)
            optimizer.zero_grad()
            outputs = model(features)
            loss = criterion(outputs, labels)
            loss.backward()
            optimizer.step()
            train_loss += loss.item()
        
        # VALIDATION
        model.eval()
        correct = 0
        total = 0
        with torch.no_grad():
            for features, labels in val_loader:
                features, labels = features.to(device), labels.to(device)
                outputs = model(features)
                _, predicted = torch.max(outputs.data, 1)
                total += labels.size(0)
                correct += (predicted == labels).long().sum().item()  # type: ignore
        
        accuracy = 100 * correct / total
        print(f"Epoch {epoch}: Loss: {train_loss/len(train_loader):.4f}, Val Accuracy: {accuracy:.2f}%")

    # 5. ONNX EXPORT
    dummy_input = torch.randn(1, 128).to(device)
    torch.onnx.export(
        model, dummy_input, 
        "sentinel_brain_v2.onnx", 
        input_names=['input'], 
        output_names=['output'],
        dynamic_axes={'input': {0: 'batch_size'}}
    )
    print("Exported to ONNX: sentinel_brain_v2.onnx")

if __name__ == "__main__":
    train_sentinel()
