(function initLoudEaseProgrammePolicy(global) {
  if (global.LoudEaseProgrammePolicy) {
    return;
  }

  const DB_FLOOR_ENERGY = 1e-12;
  const DEFAULT_PARAMS = Object.freeze({
    programmeTargetDb: -19,
    absoluteGateDb: -70,
    relativeGateDb: 10,
    histogramMinDb: -70,
    histogramMaxDb: 0,
    histogramBinDb: 0.5,
    programmeDeadbandDb: 1,
    dynamicsDeadbandDb: 1,
    dynamicsAmount: 0.72,
    fastCutMarginDb: 3,
    maxCutDb: 24,
    maxLiftDb: 25,
    liftLimiterBudgetDb: 10,
    confidenceStartBlocks: 1,
    confidenceFullBlocks: 9,
    transitionAllowanceDb: 3,
    transitionDefaultCrestDb: 6
  });

  function finite(value, fallback) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : fallback;
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function percent(value, fallback = 100) {
    return clamp(finite(value, fallback), 0, 100);
  }

  function dbToEnergy(value) {
    return Math.pow(10, (finite(value, -120) + 0.691) / 10);
  }

  function energyToDb(value) {
    return -0.691 + 10 * Math.log10(Math.max(DB_FLOOR_ENERGY, finite(value, 0)));
  }

  function applyDeadband(value, deadbandDb) {
    const magnitude = Math.max(0, Math.abs(finite(value, 0)) - Math.max(0, finite(deadbandDb, 0)));
    return Math.sign(value) * magnitude;
  }

  function scaleByDirection(value, cutScale, liftScale) {
    return value < 0 ? value * cutScale : value * liftScale;
  }

  class ProgrammeLoudnessEstimator {
    constructor(params = DEFAULT_PARAMS) {
      this.params = { ...DEFAULT_PARAMS, ...params };
      const span = this.params.histogramMaxDb - this.params.histogramMinDb;
      this.binCount = Math.max(1, Math.ceil(span / this.params.histogramBinDb) + 1);
      this.counts = new Uint32Array(this.binCount);
      this.energySums = new Float64Array(this.binCount);
      this.state = {};
      this.reset();
    }

    reset() {
      this.counts.fill(0);
      this.energySums.fill(0);
      this.acceptedBlocks = 0;
      this.programmeDb = null;
      this.ungatedDb = null;
      this.relativeThresholdDb = null;
    }

    addBlock(energy) {
      const safeEnergy = Math.max(0, finite(energy, 0));
      const blockDb = energyToDb(safeEnergy);
      if (blockDb < this.params.absoluteGateDb) {
        return this.snapshot();
      }
      const rawIndex = Math.floor((blockDb - this.params.histogramMinDb) / this.params.histogramBinDb);
      const index = clamp(rawIndex, 0, this.binCount - 1);
      this.counts[index] += 1;
      this.energySums[index] += safeEnergy;
      this.acceptedBlocks += 1;
      this.recompute();
      return this.snapshot();
    }

    recompute() {
      let totalCount = 0;
      let totalEnergy = 0;
      for (let index = 0; index < this.binCount; index += 1) {
        totalCount += this.counts[index];
        totalEnergy += this.energySums[index];
      }
      if (!totalCount) {
        this.programmeDb = null;
        this.ungatedDb = null;
        this.relativeThresholdDb = null;
        return;
      }

      this.ungatedDb = energyToDb(totalEnergy / totalCount);
      this.relativeThresholdDb = Math.max(
        this.params.absoluteGateDb,
        this.ungatedDb - this.params.relativeGateDb
      );
      let gatedCount = 0;
      let gatedEnergy = 0;
      for (let index = 0; index < this.binCount; index += 1) {
        const binUpperDb = this.params.histogramMinDb + ((index + 1) * this.params.histogramBinDb);
        if (binUpperDb < this.relativeThresholdDb) {
          continue;
        }
        gatedCount += this.counts[index];
        gatedEnergy += this.energySums[index];
      }
      this.programmeDb = gatedCount ? energyToDb(gatedEnergy / gatedCount) : this.ungatedDb;
    }

    snapshot() {
      const start = Math.max(0, Math.floor(this.params.confidenceStartBlocks));
      const full = Math.max(start + 1, Math.floor(this.params.confidenceFullBlocks));
      this.state.programmeDb = this.programmeDb;
      this.state.ungatedDb = this.ungatedDb;
      this.state.relativeThresholdDb = this.relativeThresholdDb;
      this.state.acceptedBlocks = this.acceptedBlocks;
      this.state.confidence = clamp((this.acceptedBlocks - start) / (full - start), 0, 1);
      return this.state;
    }
  }

  function computeTargetGainDb(input = {}, params = DEFAULT_PARAMS, output = {}) {
    const options = params === DEFAULT_PARAMS ? DEFAULT_PARAMS : { ...DEFAULT_PARAMS, ...params };
    const enabled = input.enabled !== false;
    const cutScale = percent(input.cutStrength, 100) / 100;
    const liftScale = percent(input.liftStrength, 100) / 100;
    const signalActive = input.signalActive === true;
    if (!enabled || !signalActive || Math.max(cutScale, liftScale) <= 0) {
      output.targetGainDb = 0;
      output.programmeCorrectionDb = 0;
      output.dynamicsCorrectionDb = 0;
      output.fastProtectionDb = 0;
      output.confidence = 0;
      output.liftBudgetDb = 0;
      output.programmeDb = options.programmeTargetDb;
      output.momentaryDb = options.programmeTargetDb;
      output.fastDb = options.programmeTargetDb;
      return output;
    }

    const programmeDb = finite(input.programmeDb, options.programmeTargetDb);
    const momentaryDb = finite(input.momentaryDb, programmeDb);
    const fastDb = finite(input.fastDb, momentaryDb);
    const peakDb = finite(input.peakDb, fastDb);
    const limiterCeilingDb = finite(input.limiterCeilingDb, -3);
    const confidence = clamp(finite(input.confidence, 0), 0, 1);

    const programmeErrorDb = applyDeadband(
      options.programmeTargetDb - programmeDb,
      options.programmeDeadbandDb
    );
    const programmeCorrectionDb = scaleByDirection(
      programmeErrorDb,
      cutScale,
      liftScale
    ) * confidence;

    const dynamicsErrorDb = applyDeadband(
      -(momentaryDb - programmeDb),
      options.dynamicsDeadbandDb
    );
    const dynamicsCorrectionDb = scaleByDirection(
      dynamicsErrorDb * options.dynamicsAmount,
      cutScale,
      liftScale
    ) * confidence;

    const fastExcessDb = Math.max(0, fastDb - (options.programmeTargetDb + options.fastCutMarginDb));
    const fastProtectionDb = fastExcessDb * cutScale;
    let targetGainDb = programmeCorrectionDb + dynamicsCorrectionDb;
    if (fastProtectionDb > 0) {
      targetGainDb = Math.min(targetGainDb, -fastProtectionDb);
    }

    const maximumCutDb = options.maxCutDb * cutScale;
    const maximumLiftDb = input.canLift === false ? 0 : options.maxLiftDb * liftScale;
    const rawHeadroomDb = limiterCeilingDb - peakDb - 0.5;
    const liftBudgetDb = Math.max(0, rawHeadroomDb + (options.liftLimiterBudgetDb * liftScale));
    targetGainDb = clamp(targetGainDb, -maximumCutDb, Math.min(maximumLiftDb, liftBudgetDb));

    output.targetGainDb = targetGainDb;
    output.programmeCorrectionDb = programmeCorrectionDb;
    output.dynamicsCorrectionDb = dynamicsCorrectionDb;
    output.fastProtectionDb = fastProtectionDb;
    output.confidence = confidence;
    output.liftBudgetDb = liftBudgetDb;
    output.programmeDb = programmeDb;
    output.momentaryDb = momentaryDb;
    output.fastDb = fastDb;
    return output;
  }

  function computeTransitionCeilingDb(input = {}, params = DEFAULT_PARAMS) {
    const options = params === DEFAULT_PARAMS ? DEFAULT_PARAMS : { ...DEFAULT_PARAMS, ...params };
    const baseCeilingDb = finite(input.baseCeilingDb, -3);
    const cutScale = percent(input.cutStrength, 100) / 100;
    if (cutScale <= 0) {
      return baseCeilingDb;
    }
    const recentOutputPeakDb = Number(input.recentOutputPeakDb);
    const programmeTargetDb = finite(input.programmeTargetDb, options.programmeTargetDb);
    const programmePeakDb = programmeTargetDb + options.transitionDefaultCrestDb;
    const learnedPeakDb = Number.isFinite(recentOutputPeakDb)
      ? recentOutputPeakDb + options.transitionAllowanceDb
      : programmePeakDb;
    const protectedCeilingDb = Math.min(baseCeilingDb, programmePeakDb, learnedPeakDb);
    return baseCeilingDb + ((protectedCeilingDb - baseCeilingDb) * cutScale);
  }

  const api = Object.freeze({
    DEFAULT_PARAMS,
    ProgrammeLoudnessEstimator,
    applyDeadband,
    computeTargetGainDb,
    computeTransitionCeilingDb,
    dbToEnergy,
    energyToDb
  });
  global.LoudEaseProgrammePolicy = api;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(globalThis);
