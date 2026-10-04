# Data sources and attribution

The BeeGuard code is MIT licensed. The source data below retains its own licenses; the repository's MIT license does not replace them. Original filenames and scientific fields are preserved.

## ApisTox

Source: [ApisTox dataset repository](https://github.com/j-adamczyk/ApisTox_dataset). License: [CC BY-NC 4.0](https://creativecommons.org/licenses/by-nc/4.0/).

Citation: Adamczyk J., Poziemski J., Siedlecki P. *ApisTox: a new benchmark dataset for the classification of small molecules toxicity on honey bees.* Scientific Data 12, 5 (2025). [DOI: 10.1038/s41597-024-04232-w](https://doi.org/10.1038/s41597-024-04232-w).

`dataset_final.csv`, `time_train.csv`, `time_test.csv`, `maxmin_train.csv`, and `maxmin_test.csv` are upstream CSV snapshots downloaded by `lab/scripts/fetch_data.py`. `manifest.json` records each source URL, byte count, and SHA256. The complete dataset contains 1,035 molecules.

The engine uses a compound first-report year cutoff, while the official split CSVs use their supplied split definitions. A compound's year does not establish when its toxicity label was available. The acute non-toxic label does not establish field or chronic safety; see the main README for benchmark limitations.

## ChEMBL

Source: [ChEMBL web services](https://www.ebi.ac.uk/chembl/api/data/). License: [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/).

Citation: Zdrazil B. et al. *The ChEMBL Database in 2023: a drug discovery platform spanning multiple bioactivity data types and time periods.* Nucleic Acids Research 52, D1180–D1192 (2024). [DOI: 10.1093/nar/gkad1004](https://doi.org/10.1093/nar/gkad1004).

`chembl_apis.csv` contains 172 organism-target activity records for Apis mellifera and Bombus terrestris. `chembl_pests.csv` contains 12,851 crop-pest activity records. They preserve the selected source fields returned by `lab/scripts/fetch_chembl.py`, including molecule, assay and document IDs, standard comparison relations, values, and units. Activity rows are not necessarily unique molecules. `chembl_manifest.json` records the source endpoint, targets, retrieval time, query limits, counts, and SHA256 values.

## Derived artifacts and other source records

`derived/` contains reproducible scientific outputs and saved display/provenance artifacts. ApisTox and ChEMBL inputs remain subject to their source terms and attribution when used in derived data; no blanket MIT license is assigned to these source records.

PubChem title/common-name caches cite [PubChem](https://pubchem.ncbi.nlm.nih.gov/) and the [NCBI data policy](https://www.ncbi.nlm.nih.gov/home/about/policies/). The saved literature graph records which providers responded and retains paper identifiers, source URLs and metadata. The source registry distinguishes OpenAlex metadata under CC0, Europe PMC metadata with article-specific licenses, and arXiv metadata with author-specific paper licenses. Article and abstract permissions remain with their underlying sources; listing a provider in the registry does not mean every provider supplied the cached graph.

`derived/agent_runs.json` contains extracted, recorded Omnigent conversations; `derived/agent_topology.json` describes the agent bundle. These are saved provenance artifacts, not newly executed LLM sessions or proof of a newly approved experiment. Scientific claims should be checked against measured tool results and benchmark outputs. `lab/beeguard/brand.py` holds the application's source registry and attribution links.
