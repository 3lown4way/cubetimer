use rand::prelude::*;
use rand_chacha::ChaCha8Rng;
use std::collections::HashMap;

const CP_SIZE: usize = 40320;
const EP_SIZE: usize = 40320;
const SEP_SIZE: usize = 24;

const HTR_SLOTS: [usize; 6] = [1, 4, 6, 7, 8, 9];

#[derive(Clone, Debug)]
pub struct HtrMLModel {
    w1: Vec<f32>,
    b1: Vec<f32>,
    w2: Vec<f32>,
    b2: Vec<f32>,
    w3: Vec<f32>,
    b3: Vec<f32>,
    w_len: Vec<f32>,
    b_len: f32,
    w_moves: Vec<f32>,
}

impl Default for HtrMLModel {
    fn default() -> Self {
        Self {
            w1: vec![0.0; 3 * 64],
            b1: vec![0.0; 64],
            w2: vec![0.0; 64 * 128],
            b2: vec![0.0; 128],
            w3: vec![0.0; 128 * 64],
            b3: vec![0.0; 64],
            w_len: vec![0.0; 64],
            b_len: 0.0,
            w_moves: vec![0.0; 64 * 6],
        }
    }
}

impl HtrMLModel {
    pub fn new() -> Self {
        let mut rng = ChaCha8Rng::from_seed([42; 32]);
        let mut model = Self::default();
        model.randomize(&mut rng);
        model
    }

    pub fn randomize(&mut self, rng: &mut ChaCha8Rng) {
        let scale = 0.1;
        for x in self.w1.iter_mut() { *x = (rng.gen::<f32>() - 0.5) * scale; }
        for x in self.b1.iter_mut() { *x = 0.0; }
        for x in self.w2.iter_mut() { *x = (rng.gen::<f32>() - 0.5) * scale; }
        for x in self.b2.iter_mut() { *x = 0.0; }
        for x in self.w3.iter_mut() { *x = (rng.gen::<f32>() - 0.5) * scale; }
        for x in self.b3.iter_mut() { *x = 0.0; }
        for x in self.w_len.iter_mut() { *x = (rng.gen::<f32>() - 0.5) * scale; }
        self.b_len = 1.0;
        for x in self.w_moves.iter_mut() { *x = (rng.gen::<f32>() - 0.5) * scale; }
    }

    fn relu(&self, x: f32) -> f32 {
        if x > 0.0 { x } else { 0.0 }
    }

    pub fn forward(&self, cp: f32, ep: f32, sep: f32) -> (f32, [f32; 6]) {
        let input = [cp, ep, sep];

        let h1: Vec<f32> = (0..64).map(|i| {
            let mut sum = self.b1[i];
            for j in 0..3 {
                sum += input[j] * self.w1[j * 64 + i];
            }
            self.relu(sum)
        }).collect();

        let h2: Vec<f32> = (0..128).map(|i| {
            let mut sum = self.b2[i];
            for j in 0..64 {
                sum += h1[j] * self.w2[j * 128 + i];
            }
            self.relu(sum)
        }).collect();

        let h3: Vec<f32> = (0..64).map(|i| {
            let mut sum = self.b3[i];
            for j in 0..128 {
                sum += h2[j] * self.w3[j * 64 + i];
            }
            self.relu(sum)
        }).collect();

        let len = {
            let mut sum = self.b_len;
            for i in 0..64 {
                sum += h3[i] * self.w_len[i];
            }
            sum
        };

        let mut moves = [0.0f32; 6];
        for i in 0..6 {
            let mut sum = 0.0f32;
            for j in 0..64 {
                sum += h3[j] * self.w_moves[j * 6 + i];
            }
            moves[i] = sum;
        }

        (len, moves)
    }

    pub fn predict(&self, cp_norm: f32, ep_norm: f32, sep_norm: f32) -> Vec<u8> {
        let (len, moves) = self.forward(cp_norm, ep_norm, sep_norm);

        let len_int = len.round().clamp(0.0, 6.0) as usize;

        let mut result = Vec::with_capacity(len_int);
        for i in 0..len_int {
            let move_idx = i % 6;
            result.push(HTR_SLOTS[move_idx] as u8);
        }

        result
    }

    pub fn train_step(&mut self, cp: f32, ep: f32, sep: f32, target_len: f32, target_moves: &[usize], lr: f32) -> f32 {
        let (len, moves) = self.forward(cp, ep, sep);

        let len_loss = (len - target_len).powi(2);

        let mut move_loss = 0.0f32;
        for (i, &target) in target_moves.iter().enumerate().take(6) {
            let target_idx = HTR_SLOTS.iter().position(|&s| s == target).unwrap_or(0) as f32;
            let diff = moves[i] - target_idx;
            move_loss += diff.powi(2);
        }
        move_loss /= 6.0;

        let loss = len_loss + move_loss;

        let len_grad = 2.0 * (len - target_len);

        for i in 0..64 {
            let grad = len_grad * self.w_len[i] * 0.001 * lr;
            self.w_len[i] -= grad;
        }
        self.b_len -= len_grad * 0.001 * lr;

        loss
    }

    pub fn train(&mut self, samples: &[TrainingSample], epochs: usize, lr: f32) -> f32 {
        let mut rng = ChaCha8Rng::from_seed([42; 32]);
        let mut total_loss = 0.0f32;

        for epoch in 0..epochs {
            let mut epoch_loss = 0.0f32;

            for sample in samples {
                let loss = self.train_step(
                    sample.cp_norm,
                    sample.ep_norm,
                    sample.sep_norm,
                    sample.target_len,
                    &sample.target_moves,
                    lr,
                );
                epoch_loss += loss;
            }

            total_loss = epoch_loss / samples.len() as f32;

            if epoch % 10 == 0 {
                println!("Epoch {}: loss = {:.4}", epoch, total_loss);
            }
        }

        total_loss
    }
}

#[derive(Clone)]
pub struct TrainingSample {
    pub cp_norm: f32,
    pub ep_norm: f32,
    pub sep_norm: f32,
    pub target_len: f32,
    pub target_moves: Vec<usize>,
}

pub fn generate_training_samples(
    tables: &crate::twophase_bundle::TwophaseTables,
    n_samples: usize,
    max_depth: usize,
    rng: &mut ChaCha8Rng,
) -> Vec<TrainingSample> {
    let mut samples = Vec::with_capacity(n_samples);
    let mut generated = 0;
    let mut attempts = 0;

    while generated < n_samples && attempts < n_samples * 10 {
        attempts += 1;

        let cp_idx = rng.gen_range(0..CP_SIZE);
        let ep_idx = rng.gen_range(0..EP_SIZE);
        let sep_idx = rng.gen_range(0..SEP_SIZE);

        if cp_idx == 0 {
            continue;
        }

        if let Some(trigger) = find_htr_trigger_bfs(cp_idx, ep_idx, sep_idx, tables, max_depth) {
            samples.push(TrainingSample {
                cp_norm: cp_idx as f32 / CP_SIZE as f32,
                ep_norm: ep_idx as f32 / EP_SIZE as f32,
                sep_norm: sep_idx as f32 / SEP_SIZE as f32,
                target_len: trigger.len() as f32,
                target_moves: trigger,
            });
            generated += 1;
        }
    }

    samples
}

fn find_htr_trigger_bfs(
    start_cp: usize,
    start_ep: usize,
    start_sep: usize,
    tables: &crate::twophase_bundle::TwophaseTables,
    max_depth: usize,
) -> Option<Vec<usize>> {
    use std::collections::VecDeque;

    let mut visited = HashMap::new();
    let mut queue = VecDeque::new();
    queue.push_back((start_cp, start_ep, start_sep, vec![]));

    while let Some((cp, ep, sep, path)) = queue.pop_front() {
        if path.len() >= max_depth {
            continue;
        }

        let key = (cp, ep, sep);
        if let Some(&prev_len) = visited.get(&key) {
            if prev_len <= path.len() {
                continue;
            }
        }
        visited.insert(key, path.len());

        if cp == 0 && !path.is_empty() {
            return Some(path);
        }

        for &slot in &HTR_SLOTS {
            if !path.is_empty() && path[path.len() - 1] == slot {
                continue;
            }

            let new_cp = tables.phase2_cp_move.get(cp, slot) as usize;
            let new_ep = tables.phase2_ep_move.get(ep, slot) as usize;
            let new_sep = tables.phase2_sep_move.get(sep, slot) as usize;

            let mut new_path = path.clone();
            new_path.push(slot);
            queue.push_back((new_cp, new_ep, new_sep, new_path));
        }
    }

    None
}

pub fn build_htr_model(
    tables: &crate::twophase_bundle::TwophaseTables,
    n_samples: usize,
) -> HtrMLModel {
    let mut rng = ChaCha8Rng::from_seed([42; 32]);

    println!("Generating {} training samples...", n_samples);
    let samples = generate_training_samples(tables, n_samples, 6, &mut rng);
    println!("Generated {} samples", samples.len());

    let mut model = HtrMLModel::new();

    println!("Training model...");
    let final_loss = model.train(&samples, 50, 0.01);
    println!("Final loss: {:.4}", final_loss);

    model
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_model_predict() {
        let model = HtrMLModel::new();
        let trigger = model.predict(0.5, 0.5, 0.5);
        println!("Predicted trigger: {:?}", trigger);
        assert!(!trigger.is_empty());
    }
}
