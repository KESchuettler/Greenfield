const moment = require('moment');
const Themeparks = require('themeparks');
const async = require('async');

const util = require('./utils');
const Rides = require('../collections/rides');
const Ride = require('../models/rideModel');
const Parks = require('../collections/parks');
const Park = require('../models/parkModel');
const RideWaitTimes = require('../collections/rideWaitTimes');
const RideWaitTime = require('../models/rideWaitTimeModel');
// const WeatherEntries = require('../collections/WeatherEntries');
const Weather = require('../models/weatherModel');
let data = require('../../data/parkLocations');
const request = require('request');
const express = require('express');
const app = express();



// Helper Functions


let helpers = {

  returnWaitTimes : rideIdList => {
    return Promise.all(eval(rideIdList).map(rideId => {
      return new Promise((resolve, reject) => {
          RideWaitTime.where({'rideId' : rideId}).fetchAll()
            .then(modelArray => {
            // timeData will be a reduction of the list of RideN entries to a single object :
            // { '12:00am': [45, 20, 16, 25, 52], '12.15am' : [60, 50, 55 ...], ....}
              let rideInfo = {'timeData' : util.reduceTimeData(modelArray.models)};
              // Get the modelObj from the 'rides' table to pass back data about each ride
              Ride.where({'id' : modelArray.models[0].attributes.rideId}).fetch()
                .then(rideModel => {
                  rideInfo['rideData'] = rideModel;
                  resolve(rideInfo);
                })
                .catch(err => console.error(err));
            })
            .catch(err => reject(err));
      });
    }))
    .then(rideInfoArray => {
      // Should return an array of objs: [{rideData: {}, timeData: []}]
      return  rideInfoArray.map(rideObj => {
        let timeObj = {};
        console.log(rideObj);
        Object.keys(rideObj.timeData).sort().forEach( key => {
          let waitTotal = rideObj.timeData[key].reduce((acc, item) =>  acc + item);
          let waitAvg = waitTotal / rideObj.timeData[key].length;
          timeObj[key] = waitAvg;
        });
        rideObj.timeData = timeObj;
        return rideObj;
      });
    })
    .catch(err => console.error(err));
  },

  getWaitTimes : () => {
    util.gatherParks()
      .then(parks => {
        parks.forEach(park => {
          util.gatherWeather(park.attributes.location)
            .then(weather => {
              util.gatherWaitTimes(park.attributes.apiParkName)
              .then(waitTimes => {
                waitTimes.forEach(waitTimeObj => {
                  util.gatherRide(waitTimeObj.id)
                    .then(ride => {
                      helpers.createNewWaitEntry(ride, waitTimeObj, weather);
                    })
                    .catch(err => {
                      process.on('uncaughtException', function (err) {
                        console.log(err);
                      });
                    });
                });
              })
              .catch(err => {
                process.on('uncaughtException', function (err) {
                  console.log(err);
                });
              });
            })
            .catch(err => {
              process.on('uncaughtException', function (err) {
                console.log(err);
              });
            });
        });
      })
      .catch(err => {
        process.on('uncaughtException', function (err) {
          console.log(err);
        });
      });
  },

  createNewWaitEntry : (rideModel, waitTimeObj, weatherModel) => {
        Park.where({'id' : rideModel.parkId}).fetch()
          .then(parkModel => {
            Weather.where({'location' : parkModel.attributes.location}).fetch()
            .then(model => {
              console.log(model);
              return new RideWaitTime({
                rideId: rideModel.attributes.id,
                waitTime: waitTimeObj.waitTime,
                status: waitTimeObj.status,
                isActive: waitTimeObj.active,
                temp: JSON.parse(model.attributes.weatherObj).temperature || null,
                precip: JSON.parse(model.attributes.weatherObj).precipIntensity || null,
                date : moment().format('L'),
                hour : moment().format('LT'),
              }).save()
              .then(newModel => {
                console.log('Stored new model: ', newModel.attributes);
              })
              .catch(err => console.error(err));

            })
            .catch(err => console.log(err));
          })
          .catch(err => console.log(err));
  },

  optimizeSchedule : (rideIdList, startTime='8:00 AM') => {
    helpers.returnWaitTimes(rideIdList)
      .then(rideInfoList => {
        let possibilities = [];
        util.optimize(rideInfoList, route, time);
        // scan possibilities for shortest queue
        let shortest;
        possibilities.forEach(possibility => {
          if(shortest === undefined) {
            shortest = possibility;
          } else {
            if(possibility.time.total < shortest.time.total) {
              shortest = possibility;
            }
          }
        });
        let results = shortest.route.map(ride => {
          return ride.rideData;
        });
        return results;
      });
  },
  /*======================================
    ======     POPULATION HELPERS    =====
    The functions below serve only to populate
    the "rides" and "parks" tables for future use.
    Do not call these functions once the tables
    have been created as they do not check if the
    model already exists and will duplicate entries,
    doubling the run time of functions that iterate through each park or ride.
    ====================================== */



  populateRidesTable: () => {
    // ======================================
    // ======     ONLY RUN ONE TIME     =====
    // ======================================
    for( let park in Themeparks.Parks) {
      if (Themeparks.Parks.hasOwnProperty(park)) {
        let parkObj = new Themeparks.Parks[park]();
        let name = parkObj.Name;
        Park.where('parkName', name).fetch()
        .then(parkEntry => {
          parkObj.GetWaitTimes()
            .then(apiRidesArr => {
              apiRidesArr.forEach(apiRideObj=> {
                helper.createNewRide(apiRideObj, parkEntry);
              });
            });
        });
      }
    }
  },

  checkIfRideExists: apiRideObj => {
    // Returns a promise that eventually resolves to true or false
    return Rides.fetchOne({'apiId': apiRideObj.id})
      .then(exists => !!exists)
      .catch(err => console.error(err));
  },

  createNewRide : (apiRideObj, parkEntry) => {
          return new Ride({
            apiId : apiRideObj.id,
            rideName: apiRideObj.name,
            parkId : parkEntry.id,
            hasFastPass: apiRideObj.fastPass,
            location: parkEntry.location
          }).save()
          .then( ride => {
            //console.log(ride);
          })
          .catch( err => {
            console.error(err);
          });
  },

  populateParksTable : () => {
    // ======================================
    // ======     ONLY RUN ONE TIME     =====
    // ======================================
    let parkArr = [];
    for( let park in Themeparks.Parks) {
      if (Themeparks.Parks.hasOwnProperty(park)) {
        let currPark = new Themeparks.Parks[park]();
        parkArr.push({
          'apiParkName' : park,
          'parkName': currPark.Name,
          'location' : JSON.stringify({
            'latitude' : currPark.Location.LatitudeRaw,
            'longitude' :currPark.Location.LongitudeRaw
          }),
          'fastPass' : currPark.FastPass
        });

      }
    }
    parkArr.forEach(parkObj => {
      helpers.createNewPark(parkObj);
    });
  },

  createNewPark: parkObj => {
    helpers.checkIfParkExists(parkObj)
      .then(exists => {
        if(!exists) {
          return new Park({
          parkName : parkObj.parkName,
          apiParkName : parkObj.apiParkName,
          location : parkObj.location,
          hasFastPass : parkObj.fastPass,
        }).save()
          .then( themepark => {
            console.log(themepark);
          })
          .catch( err => {
            console.error(err);
          });
        }
      });
  },

  checkIfParkExists: apiParkObj => {
    // Returns a promise that eventually resolves to true or false
    return Parks.fetchOne({'apiId': apiParkObj.id})
      .then(exists => !!exists)
      .catch(err => console.error(err));
  },

  createWeatherEntry: (loc, weatherObj) => {
    return new Weather({
      location : JSON.stringify(loc),
      weatherObj : JSON.stringify(weatherObj)
    }).save()
    .then( weatherEntry => {
      console.log(weatherEntry);
    })
    .catch( err => {
      console.error(err);
    });
  },

  updateWeatherEntry: (loc, weatherObj) => {
    return new Weather({
      location : JSON.stringify(loc),
      weatherObj : JSON.stringify(weatherObj)
    }).save()
    .then( weatherEntry => {
      console.log(weatherEntry);
    })
    .catch( err => {
      console.error(err);
    });
  },

  getWeatherAtPosition: () => {
    let data = require('../data/parkLocations');

    data.forEach(loc => {
      let long = loc.location.longitude;
      let lat = loc.location.latitude;
      request(`https://api.darksky.net/forecast/${process.env.DARK_SKY_API}/${lat},${long}`, (err, res, body) => {
        if (err) {
          console.error(err);
        } else {
          let currentWeather = JSON.parse(body).currently;
          util.gatherWeather({latitude: lat, longitude: long}).then( weather => {
            if (weather) {
              console.log('Model at location exists. Overwriting...');
              weather.attributes.weatherObj = JSON.stringify({precipIntensity: currentWeather.precipIntensity, temperature: currentWeather.temperature});
              weather.save();
            } else {
              console.log('Model at location does not exists. Creating new model.');
              helpers.createWeatherEntry({latitude: lat, longitude: long}, {precipIntensity: currentWeather.precipIntensity, temperature: currentWeather.temperature});
            }
          });
        }
      });
    });
  },

  addRideDescriptions: () => {
    console.log('ADDING RIDE DESCRIPTIONS');
    Ride.fetchAll()
      .then(rides => {
        rides.forEach(ride => {
          var options = {
            url: `https://en.wikipedia.org/w/api.php?format=json&action=query&prop=extracts&exintro=explaintext&titles=${ride.attributes.rideName}&redirects=1`,
            port: 3000,
            json: true
          };
          request(options, (err, res, body) => {
            if (body !== undefined && body.query !== undefined) {
              for (let key in body.query.pages) {
                let pageid = key;
              }
              let description = body.query.pages[pageid].extract;
              if (description !== null && description !== undefined) {
                description = description.replace(/<{1}[^<>]{1,}>{1}/g,"");
                ride.attributes.description = description;
                ride.save();
              } else {
                ride.attributes.description = 'No Description!';
                ride.save();
              }
            } else {
              ride.attributes.description = 'No Description!';
              ride.save();
            }
          });
        });
      });
  }
};

module.exports = helpers;
