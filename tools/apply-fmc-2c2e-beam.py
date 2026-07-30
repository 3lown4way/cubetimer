from pathlib import Path

path = Path("solver-wasm/src/fmc_search.rs")
text = path.read_text()
old = '''    let mut selected = Vec::new();
    let mut selected_keys = std::collections::HashSet::new();
    let mut bucket_counts = std::collections::HashMap::<(FmcSkeletonKind, u8, u8), usize>::new();

    for quota in 1..=FMC_SKELETON_PER_BUCKET {'''
new = '''    let mut selected = Vec::new();
    let mut selected_keys = std::collections::HashSet::new();
    let mut bucket_counts = std::collections::HashMap::<(FmcSkeletonKind, u8, u8), usize>::new();

    // Reserve one beam slot for each supported leftover family before normal
    // source/axis quotas. Without this, the 24 legacy 3C/3E buckets can fill
    // the entire beam before any 2C2E relocation skeleton is considered.
    for kind in [
        FmcSkeletonKind::Corner3,
        FmcSkeletonKind::Edge3,
        FmcSkeletonKind::Corner2Edge2,
    ] {
        if let Some((index, candidate)) = candidates
            .iter()
            .enumerate()
            .find(|(index, candidate)| candidate.kind == kind && !selected_keys.contains(index))
        {
            let bucket = (candidate.kind, candidate.source_tag, candidate.axis);
            selected.push(candidate.clone());
            selected_keys.insert(index);
            *bucket_counts.entry(bucket).or_insert(0) += 1;
        }
    }

    for quota in 1..=FMC_SKELETON_PER_BUCKET {'''
if text.count(old) != 1:
    raise RuntimeError(f"expected one beam anchor, found {text.count(old)}")
path.write_text(text.replace(old, new, 1))
