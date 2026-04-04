const assert = require('assert');
const chai = require('chai');
const expect = chai.expect;
const { Mp3File, MusicManager, Player } = require('./index');

describe('Music App Backend', () => {
  it('should add MP3 file to database', (done) => {
    const mp3File = new Mp3File(1, 'example.mp3');
    const musicManager = new MusicManager();
    musicManager.addMp3File(mp3File);
    expect(musicManager.getMp3Files()).to.include(mp3File);
    done();
  });

  it('should retrieve list of MP3 files', (done) => {
    const musicManager = new MusicManager();
    const mp3Files = musicManager.getMp3Files();
    expect(mp3Files).to.be.an('array');
    done();
  });

  it('should play MP3 file', (done) => {
    const player = new Player();
    player.playMp3File(new Mp3File(1, 'example.mp3'));
    expect(player.playing).to.equal(true);
    done();
  });

  it('should stop playback', (done) => {
    const player = new Player();
    player.playMp3File(new Mp3File(1, 'example.mp3'));
    player.stopPlaying();
    expect(player.playing).to.equal(false);
    done();
  });
});