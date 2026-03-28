# File: training/sentinel_brain_v2.py
# Production-ready Residual-Attention MLP for Grandmaster Form Detection

import torch  # type: ignore
import torch.nn as nn  # type: ignore
import torch.nn.functional as F  # type: ignore

class ResidualBlock(nn.Module):
    def __init__(self, in_dim, out_dim, dropout=0.15):
        super().__init__()
        self.net = nn.Sequential(
            nn.Linear(in_dim, out_dim),
            nn.BatchNorm1d(out_dim),
            nn.GELU(),
            nn.Dropout(dropout),
            nn.Linear(out_dim, out_dim),
            nn.BatchNorm1d(out_dim),
            nn.GELU(),
        )
        self.skip = nn.Linear(in_dim, out_dim) if in_dim != out_dim else nn.Identity()

    def forward(self, x):
        return self.net(x) + self.skip(x)

class SentinelBrainV2(nn.Module):
    def __init__(self):
        super().__init__()
        
        # Block-wise attention projection (8 blocks of 16 dims = 128 dims)
        self.block_count = 8
        self.block_dim = 16
        
        self.input_norm = nn.LayerNorm(128)
        
        # Self-attention over feature blocks (Structural, Semantic, Spatial, etc.)
        self.attention = nn.MultiheadAttention(
            embed_dim=self.block_dim,
            num_heads=4,
            batch_first=True
        )

        # Main processing blocks
        self.res_layers = nn.Sequential(
            ResidualBlock(128, 256),
            ResidualBlock(256, 512),
            ResidualBlock(512, 128),
            ResidualBlock(128, 64)
        )

        # Classification Head: [username, email, password, confirm_password, 
        #                      otp_digit, phone, submit_button, honeypot, unknown]
        self.classifier = nn.Linear(64, 9)

    def forward(self, x):
        # x shape: (batch, 128)
        
        # 1. Attention path
        h_attn = x.view(-1, self.block_count, self.block_dim)
        attn_out, _ = self.attention(h_attn, h_attn, h_attn)
        attn_flat = attn_out.reshape(-1, 128)
        
        # 2. Add-Norm & Residue
        h = self.input_norm(x + attn_flat)
        
        # 3. Residual processing
        h = self.res_layers(h)
        
        # 4. Final logits
        return self.classifier(h)

# Loss: Class-Weighted Focal Loss for rare classes like 'honeypot'
class FocalLoss(nn.Module):
    def __init__(self, alpha=None, gamma=2.0):
        super().__init__()
        self.alpha = alpha
        self.gamma = gamma

    def forward(self, inputs, targets):
        ce_loss = F.cross_entropy(inputs, targets, weight=self.alpha, reduction='none')
        pt = torch.exp(-ce_loss)
        focal_loss = torch.pow(1 - pt, self.gamma) * ce_loss
        return torch.mean(focal_loss)
