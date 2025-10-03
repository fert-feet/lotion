import Footer from "./_components/footer";
import Heading from "./_components/heading";
import LandingText from "./_components/landingText";

const MarketingPage = () => {
  return (
    <div className="min-h-full flex flex-col">
      <div className="flex flex-col items-center justify-center md:justify-center text-center gap-y-8 flex-1 px-6 pb-10">
        <Heading />
        {/* <Heroes /> */}
        <LandingText />
      </div>
      <Footer />
    </div>
  );
}

export default MarketingPage;