import Model from 'ember-data/model';
import attr from 'ember-data/attr';
import { belongsTo, hasMany } from 'ember-data/relationships';
import { observer } from '@ember/object';
import { mapBy, sum } from '@ember/object/computed';
import { computed } from '@ember/object';

export default Model.extend({
	init() {
		this._super(...arguments);
		this.entrySorting = ['addTime'];
	},
	beer: belongsTo('beer'),
	creator: belongsTo('user'),
	mashingTemp: attr('number'),
	mashingTime: attr('number'),
	mashOutTemp: attr('number'),
	mashOutTime: attr('number'),
	spargeCount: attr('number'),
	spargeWaterTemp: attr('number'),
	spargeTime: attr('number'),
	conversionEfficiency: attr('number'),
	preBoilVolume: attr('number'),
	postBoilVolume: attr('number'),
	fermentationVolume: attr('number'),
	finalVolume: attr('number'),
	boilTime: attr('number'),
	totalMaltWeight: attr('number'),
	primaryFermentationTemp: attr('number'),
	primaryFermentationTime: attr('number'),
	yeast: belongsTo('yeast'),
	yeastChanges: observer('yeast', function () {
		this.send('becomeDirty');
	}),
	yeastAmount: attr('number'),
	pitchType: belongsTo('pitch-type'),
	pitchTypeChanges: observer('pitchType', function () {
		this.send('becomeDirty');
	}),
	boilEntries: hasMany('boil-recipe-entry'),
	mashEntries: hasMany('mash-recipe-entry'),
	mashEntriesAmounts: mapBy('mashEntries', 'amount'),
	totalAmount: sum('mashEntriesAmounts'),
	sessions: hasMany('brewing-session'),
	unassignedMalt: computed('totalAmount', function () {
		return 100 - this.get('totalAmount');
	}),
	absorbedByMalt: computed('totalMaltWeight', function () {
		return this.get('totalMaltWeight') * 0.9;
	}),
	preBoilVolumeCold: computed('preBoilVolume', function () {
		return this.get('preBoilVolume') * 0.96; // Warm volume is 4% larger
	}),
	strikeWaterVolume: computed('preBoilVolumeCold', 'spargeCount', 'absorbedByMalt', function () {
		// The volume in the kettle during lautering will be larger since this is cold volume
		return this.get('preBoilVolumeCold') / (this.get('spargeCount') + 1) + this.get('absorbedByMalt');
	}),
	spargeWaterVolume: computed('preBoilVolumeCold', 'spargeCount', function () {
		// The volume in the kettle during lautering will be larger since this is cold volume
		var spargeCount = this.get('spargeCount');
		if (spargeCount < 1) {
			return 0;
		} else {
			return Number(this.get('preBoilVolumeCold')) / (spargeCount + 1); // half is from first run off and half from first sparge
		}
	}),
	waterToMaltRatio: computed('strikeWaterVolume', 'totalMaltWeight', function () {
		return this.get('strikeWaterVolume') / this.get('totalMaltWeight');
	}),
	strikeWaterTemp: computed('waterToMaltRatio', 'mashingTemp', function () {
		var mashingTemp = Number(this.get('mashingTemp')); // This will default to 0 if not set
		// Formula based on http://braukaiser.com/wiki/index.php?title=Infusion_Mashing
		// 2.09 is ratio between qt/lb and l/kg
		var maltTemp = 20; // this should be part of session
		return (0.2 / (this.get('waterToMaltRatio') / 2.09)) * (mashingTemp - maltTemp) + mashingTemp;
	}),
	lauterEfficiency: computed('spargeCount', 'absorbedByMalt', 'strikeWaterVolume', 'spargeWaterVolume', function () {
		var spargeCount = this.get('spargeCount');
		if (spargeCount === 0) {
			return 100;
		} else { // we should handle multiple sparges
			// Based on http://braukaiser.com/wiki/index.php?title=Batch_Sparging_Analysis
			var strikeWaterVolume = this.get('strikeWaterVolume');
			var spargeWaterVolume = Number(this.get('spargeWaterVolume'));
			var efficiency = (spargeWaterVolume + (this.get('absorbedByMalt') * spargeWaterVolume) / strikeWaterVolume) / strikeWaterVolume;
			return 100 * efficiency;
		}
	}),
	extractYields: mapBy('mashEntries', 'weightedExtract'),
	averageExtractYield: sum('extractYields'),
	totalExtractWeight: computed('averageExtractYield', 'totalMaltWeight', 'conversionEfficiency', function () {
		return this.get('totalMaltWeight') * this.get('averageExtractYield') * this.get('conversionEfficiency') / 100;
	}),
	firstWortSG: computed('strikeWaterVolume', 'totalExtractWeight', function () {
		var totalExtractWeight = this.get('totalExtractWeight');
		var maxPlato = 100 * totalExtractWeight / (this.get('strikeWaterVolume') + totalExtractWeight);
		return 1 + (maxPlato / (258.6 - ((maxPlato / 258.2) * 227.1)));
	}),
	relativeRunOffSize: computed('spargeWaterVolume', 'strikeWaterVolume', function () {
		// Sparge water volume is the same as the cold run off volume.
		// We want to know what percentage of the volume that ends up in the kettle (the rest is absorbed by malt)
		return this.get('spargeWaterVolume') / this.get('strikeWaterVolume');
	}),
	firstWortExtractWeight: computed('totalExtractWeight', 'relativeRunOffSize', function () {
		return this.get('totalExtractWeight') * this.get('relativeRunOffSize');
	}),
	remainingExtractWeight: computed('firstWortExtractWeight', function () {
		// dependency on totalExtractWeight is implicit from firstWortExtract
		return this.get('totalExtractWeight') - this.get('firstWortExtractWeight');
	}),
	firstSpargeSG: computed('remainingExtractWeight', function () {
		var remainingExtractWeight = this.get('remainingExtractWeight');
		// strikeWaterVolume dependency is implicit from remainingExtractWeight
		var plato = 100 * remainingExtractWeight / (this.get('strikeWaterVolume') + remainingExtractWeight);
		return 1 + (plato / (258.6 - ((plato / 258.2) * 227.1)));
	}),
	firstSpargeExtractWeight: computed('remainingExtractWeight', 'relativeRunOffSize', function () {
		return this.get('remainingExtractWeight') * this.get('relativeRunOffSize');
	}),
	kettleExtractWeight: computed('firstWortExtractWeight', 'firstSpargeExtractWeight', function () {
		// This is the total amount of extract that we get into the boiling kettle and it will detemine both SG and OG
		return this.get('firstWortExtractWeight') + this.get('firstSpargeExtractWeight');
	}),
	brewhouseEfficiency: computed('kettleExtractWeight', function () {
		// totalExtractWeight dependency is implicit
		return 100 * this.get('kettleExtractWeight') / this.get('totalExtractWeight');
	}),
	preBoilSG: computed('kettleExtractWeight', 'preBoilVolumeCold', function () {
		// ew = 2.59(sg - 1) * V
		// sg = ew/(V * 2.59) + 1
		return 1 + (this.get('kettleExtractWeight') / (this.get('preBoilVolumeCold') * 2.59));
	}),
	postBoilVolumeCold: computed('postBoilVolume', function () {
		return this.get('postBoilVolume') * 0.96; // Warm volume is 4% larger
	}),
	boilOff: computed('preBoilVolume', 'postBoilVolume', 'boilTime', function () {
		// boil off per hour
		return (this.get('preBoilVolume') - this.get('postBoilVolume')) / this.get('boilTime') * 60;
	}),
	sortedBoilEntries: computed.sort('boilEntries', 'entrySorting'),
	boilExtracts: mapBy('boilEntries', 'extractWeight'),
	totalBoilExtract: sum('boilExtracts'),
	postBoilExtract: computed('totalBoilExtract', 'kettleExtractWeight', function () {
		return this.get('kettleExtractWeight') + this.get('totalBoilExtract');
	}),
	OG: computed('postBoilExtract', 'postBoilVolumeCold', function () {
		// ew = 2.59(sg - 1) * V
		// sg = ew/(V * 2.59) + 1
		return 1 + (this.get('postBoilExtract') / (this.get('postBoilVolumeCold') * 2.59));
	}),
	OGPlato: computed('OG', function () {
		return 259 - (259 / this.get('OG'));
	}),
	leftInKettle: computed('postBoilVolumeCold', 'fermentationVolume', function () {
		return this.get('postBoilVolumeCold') - this.get('fermentationVolume');
	}),
	leftInFermentor: computed('finalVolume', 'fermentationVolume', function () {
		return this.get('fermentationVolume') - this.get('finalVolume');
	}),
	IBUValues: mapBy('boilEntries', 'IBU'),
	IBU: sum('IBUValues'),
	yeastCellsNeeded: computed('OGPlato', 'fermentationVolume', 'pitchType.pitchRate', function () {
		return this.get('OGPlato') * this.get('fermentationVolume') * this.get('pitchType.pitchRate');
	}),
	yeastNeeded: computed('yeastCellsNeeded', 'yeast.cellConcentration', function () {
		return this.get('yeastCellsNeeded') / this.get('yeast.cellConcentration');
	}),
	FG: computed('OG', 'yeast.attenuation', function () {
		return ((this.get('OG') - 1.0) * (1.0 - (this.get('yeast.attenuation') / 100.0))) + 1.0;
	}),
	FGPlato: computed('FG', function () {
		return 259 - (259 / this.get('FG'));
	}),
	realFG: computed('FG', function () {
		return 1 + (0.1808 * (this.get('OG') - 1) + 0.8192 * (this.get('FG') - 1));
	}),
	realFGPlato: computed('realFG', function () {
		return 259 - (259 / this.get('realFG'));
	}),
	postFermentationExtractWeight: computed('realFG', 'realFGPlato', 'fermentationVolume', function () {
		// volume * gravity = weight of the wort
		// plato is weight percentage extract
		// weight of wort * (plato / 100) = extract weight
		return this.get('fermentationVolume') * this.get('realFG') * (this.get('realFGPlato') / 100);
	}),
	ABW: computed('OGPlato', 'realFGPlato', function () {
		var OGPlato = this.get('OGPlato');
		return (OGPlato - this.get('realFGPlato')) / (2.065 - (0.010665 * OGPlato));
	}),
	ABV: computed('FG', 'ABW', function () {
		return this.get('ABW') * (this.get('FG') / 0.794);
	}),
	approxABV: computed('OG', 'FG', function () {
		return (this.get('OG') - this.get('FG')) * 131.5;
	}),
	dissolvedCO2: computed('primaryFermentationTemp', function () {
		var temp = this.get('primaryFermentationTemp');
		// Using formula: CO2 In Beer = 3.0378 - (0.050062 * temp) + (0.00026555 * temp^2)
		// Source: https://www.brewersfriend.com/beer-priming-calculator/
		// The formula uses Fahreheit so we need to convert first
		var tempFahrenheit = (temp * 1.8000) + 32.00;
		// Need to multiply by 2 to go from volumes to g/l
		return 2 * (3.0378 - (0.050062 * tempFahrenheit) + (0.00026555 * Math.pow(tempFahrenheit, 2)));
	}),
	dissolvedCO2Test: computed('primaryFermentationTemp', function () {
		var temp = this.get('primaryFermentationTemp');
		// Cbeer = (Phead+1.013)*(2.71828182845904^(-10.73797+(2617.25/(Tbeer+273.15))))*10
		// Source: http://braukaiser.com/wiki/index.php/Carbonation_Tables
		// Assume head pressure of 1012.3 hPa = 1.0123 bar
		return (1.0123 + 1.013) * Math.pow(2.71828182845904, (-10.73797 + (2617.25 / (temp + 273.15)))) * 10;
	}),
	requiredTableSugarMin: computed('finalVolume', 'dissolvedCO2', 'beer.beerType.primingCo2Min', function () {
		// target CO2 (g/l) = dissoled CO2 (g/l) + 0.5 * mass table-sugar (g) / volume beer (l)
		// 0.5 * mass ts / volume = target CO2 - dissolved CO2
		// mass ts = (volume / 0.5) * (target CO2 - dissolved CO2)
		return (this.get('finalVolume') / 0.5) * (this.get('beer.beerType.primingCo2Min') - (this.get('dissolvedCO2')));
	}),
	requiredTableSugarMax: computed('finalVolume', 'dissolvedCO2', 'beer.beerType.primingCo2Max', function () {
		// target CO2 (g/l) = dissoled CO2 (g/l) + 0.5 * mass table-sugar (g) / volume beer (l)
		// 0.5 * mass ts / volume = target CO2 - dissolved CO2
		// mass ts = (volume / 0.5) * (target CO2 - dissolved CO2)
		return (this.get('finalVolume') / 0.5) * (this.get('beer.beerType.primingCo2Max') - (this.get('dissolvedCO2')));
	}),
});
